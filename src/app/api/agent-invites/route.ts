import { NextRequest, NextResponse } from 'next/server';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { inviteAgentToTransaction, inviteTcToTransaction, resendTcInvite } from '@/lib/agentInvite';
import { checkRateLimit } from '@/lib/rateLimit';
import { getEntitlements } from '@/lib/entitlements';
import { hasAgentRole } from '@/lib/privileged';

// Confirms the caller (a TC) owns `transactionId`, the same ownership
// check src/app/api/documents/route.ts uses -- direct-owner only, not the
// wider "Team can view" rule, since inviting someone onto a deal is a
// mutation, not a read.
async function assertOwnsTransaction(transactionId: string, userId: string, isAdmin: boolean) {
  const { data: transaction, error } = await supabaseServer
    .from('transactions')
    .select('id, agent_id, property_address')
    .eq('id', transactionId)
    .single();

  if (error || !transaction) {
    throw new AuthError('Transaction not found', 404);
  }

  if (!isAdmin) {
    const { data: agent } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('id', transaction.agent_id)
      .eq('tc_user_id', userId)
      .single();
    if (!agent) {
      throw new AuthError('You do not have permission to invite anyone to this transaction', 403);
    }
  }

  return transaction;
}

// Pending invitations addressed to this coordinator's email that an agent with a workspace sent.
async function pendingInvitesFromAgents(user: { email?: string | null } & Parameters<typeof hasAgentRole>[0]) {
  if (!user.email || hasAgentRole(user)) return [];
  const { data: invites, error } = await supabaseServer
    .from('agent_invites')
    .select('id, transaction_id, invited_by, created_at')
    .eq('email', user.email.toLowerCase())
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out: Array<{ inviteId: string; transactionId: string; propertyAddress: string | null; agentLabel: string; createdAt: string }> = [];
  for (const invite of invites || []) {
    const { data: inviter } = await supabaseServer.auth.admin.getUserById(invite.invited_by as string);
    if (!inviter.user || !hasAgentRole(inviter.user)) continue; // an older coordinator-to-agent invite: not for this list
    const { data: tx } = await supabaseServer.from('transactions').select('id, property_address').eq('id', invite.transaction_id).maybeSingle();
    if (!tx) continue;
    out.push({
      inviteId: invite.id as string,
      transactionId: tx.id as string,
      propertyAddress: (tx.property_address as string | null) ?? null,
      agentLabel: (inviter.user.user_metadata?.full_name as string | undefined) || inviter.user.email || 'An agent',
      createdAt: invite.created_at as string,
    });
  }
  return out;
}

// GET: invited/accepted agents for one transaction -- TC-only, used to
// render the "who's on this deal" list on the transaction detail page.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    if (!transactionId) {
      // No deal named: the invitations waiting for this person. Only a coordinator account is invited by an agent
      // (agents are invited by coordinators and answer on their own portal), so anyone else just gets an empty list.
      return NextResponse.json(await pendingInvitesFromAgents(user));
    }

    await assertOwnsTransaction(transactionId, user.id, isAdmin);

    const [{ data: invites, error: invitesError }, { data: accepted, error: acceptedError }] = await Promise.all([
      supabaseServer
        .from('agent_invites')
        .select('id, email, status, created_at, accepted_at')
        .eq('transaction_id', transactionId)
        .order('created_at', { ascending: false }),
      supabaseServer
        .from('transaction_agents')
        .select('agent_user_id, created_at')
        .eq('transaction_id', transactionId),
    ]);

    if (invitesError) throw invitesError;
    if (acceptedError) throw acceptedError;

    // Attach each accepted agent's email (invites already store it, but
    // an agent added a long time ago should still show correctly even if
    // their invite row was ever cleaned up).
    const acceptedWithEmail = await Promise.all(
      (accepted || []).map(async (row) => {
        const { data } = await supabaseServer.auth.admin.getUserById(row.agent_user_id);
        return {
          userId: row.agent_user_id,
          email: data.user?.email || 'unknown',
          addedAt: row.created_at,
        };
      })
    );

    return NextResponse.json({ invites: invites || [], agents: acceptedWithEmail });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agent invites:', error);
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 });
  }
}

// POST: invite an agent (by email) onto a transaction. Works the same
// whether or not this email already has an agent account elsewhere --
// generateLink creates the account on first use the same way
// signInWithOtp used to, so there's no branching needed here the way
// /api/team's invite-vs-add split needs. The actual transaction_agents
// grant isn't created at send time -- the agent signs in generically
// (this link, or a later plain /agent/login) and then explicitly accepts
// the invite from their dashboard -- see POST /api/agent-invites/accept
// and src/app/agent/page.tsx.
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    assertNotCollaborator(user);
    const body = await request.json();
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const transaction = await assertOwnsTransaction(transactionId, user.id, isAdmin);

    // An agent with a workspace invites a coordinator, never another agent; a coordinator invites agents as before.
    const callerIsWorkspaceAgent = getEntitlements(user).kind === 'agent_workspace';
    if (callerIsWorkspaceAgent || body.inviteeRole === 'tc') {
      if (!callerIsWorkspaceAgent) {
        return NextResponse.json({ error: 'Only an agent with a workspace invites a coordinator' }, { status: 403 });
      }
      // "Resend invitation": the same email again for an invitation still waiting. Three a day per coordinator address, per deal.
      if (body.resend === true) {
        if (!(await checkRateLimit(`tc-invite-resend:${user.id}:${transactionId}:${email}`, 3, 86400))) {
          return NextResponse.json({ error: 'That invitation was already sent again a few times today. Please wait and try tomorrow.' }, { status: 429 });
        }
        const resent = await resendTcInvite({ transaction, user, appUrl: request.nextUrl.origin, email, usesRelay: body.usesRelay !== false });
        if (resent === 'not_pending') return NextResponse.json({ error: 'There is no waiting invitation for that address on this deal.' }, { status: 404 });
        if (resent === 'email_failed') return NextResponse.json({ error: 'The email could not be sent. Please try again in a few minutes.' }, { status: 502 });
        if (resent !== 'sent') return NextResponse.json({ error: 'Failed to send the invitation again' }, { status: 500 });
        return NextResponse.json({ status: 'resent', email, inviteEmailSent: true });
      }
      const outcome = await inviteTcToTransaction({ transaction, user, appUrl: request.nextUrl.origin, email, usesRelay: body.usesRelay !== false });
      if (outcome === 'already') {
        return NextResponse.json({ error: 'This person has already been invited to this transaction.' }, { status: 400 });
      }
      if (outcome === 'agent_account') {
        return NextResponse.json({ error: 'That email belongs to an agent account. Invite a coordinator here.' }, { status: 400 });
      }
      // The invitation is saved (it shows as waiting, and Resend invitation works) but the email did not go out.
      if (outcome === 'email_failed') {
        return NextResponse.json({ status: 'invited', email, inviteEmailSent: false });
      }
      if (outcome !== 'sent') {
        return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
      }
      return NextResponse.json({ status: 'invited', email, inviteEmailSent: true });
    }

    // Block re-inviting the same email to the same transaction outright,
    // rather than silently refreshing the existing row -- an accepted
    // invite means they're already on the deal, and a still-pending one
    // means a link is already on its way to them.
    const { data: existingInvite, error: existingInviteError } = await supabaseServer
      .from('agent_invites')
      .select('status')
      .eq('transaction_id', transactionId)
      .eq('email', email)
      .maybeSingle();
    if (existingInviteError) throw existingInviteError;
    if (existingInvite) {
      const message =
        existingInvite.status === 'accepted'
          ? 'This agent already has access to this transaction.'
          : 'This agent has already been invited to this transaction and hasn\'t accepted yet.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // The row, the agent's login and the email are handled together (see inviteAgentToTransaction); the email links to a
    // fixed page that never expires. An email that already belongs to a non-agent account (a TC, say) is still invited:
    // that account is only made an agent when its owner accepts (api/agent-invites/accept).
    const outcome = await inviteAgentToTransaction({ transaction, user, appUrl: request.nextUrl.origin, email });
    const inviteEmailSent = outcome === 'sent';

    return NextResponse.json({ status: 'invited', email, inviteEmailSent });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error inviting agent:', error);
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
  }
}
