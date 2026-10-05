import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { sendAgentInviteEmail } from '@/lib/agentPortalEmails';
import { hasAgentRole, mergeAppMetadata } from '@/lib/privileged';

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

// GET: invited/accepted agents for one transaction -- TC-only, used to
// render the "who's on this deal" list on the transaction detail page.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
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

    const { error: insertError } = await supabaseServer.from('agent_invites').insert({
      transaction_id: transactionId,
      email,
      invited_by: user.id,
      status: 'pending',
    });
    if (insertError) throw insertError;

    const appUrl = request.nextUrl.origin;
    const tcLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'Your transaction coordinator';

    // One email, one link: generateLink creates the account (same as
    // shouldCreateUser did on signInWithOtp) and hands back the real
    // action_link WITHOUT sending anything itself -- the custom email
    // below is the only one that goes out. Safe to call straight on
    // supabaseServer (unlike signInWithOtp, this doesn't set session
    // state on the caller, so it doesn't need the throwaway client from
    // createAuthClient -- see lib/supabase.ts).
    const { data: linkData, error: linkError } = await supabaseServer.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${appUrl}/agent/accept`,
      },
    });

    // Tag a brand-new invited account as an agent right away (the agent
    // dashboard where they accept the invite is gated on this role). The
    // role lives in app_metadata, which only our server can write -- see
    // lib/privileged.ts. An email that already belongs to an existing
    // account (a TC, say) is deliberately NOT retagged here; that only
    // happens when that account's owner accepts the invite
    // (api/agent-invites/accept).
    const invitedUser = linkData?.user;
    if (
      invitedUser &&
      !invitedUser.last_sign_in_at &&
      !hasAgentRole(invitedUser) &&
      Date.now() - new Date(invitedUser.created_at).getTime() < 2 * 60 * 1000
    ) {
      try {
        await mergeAppMetadata(invitedUser.id, { role: 'agent' });
      } catch (err) {
        console.error('Error tagging invited agent account:', err);
      }
    }

    const actionLink = linkData?.properties?.action_link;
    let inviteEmailSent = true;
    if (linkError || !actionLink) {
      inviteEmailSent = false;
      console.error('Error generating agent invite link:', linkError);
    } else {
      try {
        await sendAgentInviteEmail({
          toEmail: email,
          tcLabel,
          propertyAddress: transaction.property_address || null,
          actionLink,
        });
      } catch (emailError) {
        inviteEmailSent = false;
        console.error('Error sending agent invite email:', emailError);
      }
    }

    return NextResponse.json({ status: 'invited', email, inviteEmailSent });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error inviting agent:', error);
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
  }
}
