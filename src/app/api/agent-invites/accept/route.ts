import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// POST: called from /agent/accept right after the agent's Supabase
// session is established from their emailed link. Trusts the caller's
// own verified email (from their token, via getUserFromRequest) rather
// than anything in the request body -- that's what makes this safe to
// call with no other secret: you can only end up with a session for an
// email you actually received the link at.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }
    if (!user.email) {
      return NextResponse.json({ error: 'This account has no email on file' }, { status: 400 });
    }

    const { data: invite, error: inviteError } = await supabaseServer
      .from('agent_invites')
      .select('id, status, invited_by')
      .eq('transaction_id', transactionId)
      .eq('email', user.email.toLowerCase())
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) {
      throw new AuthError('No invite found for this transaction and email', 403);
    }

    // Make sure this account is actually tagged as an agent -- covers the
    // case where signInWithOtp found an existing (non-agent) account
    // under this email instead of creating a fresh one, which would
    // otherwise silently let a TC's own login end up with agent access
    // too. Self-heals by setting the flag rather than erroring, since the
    // invite itself already proves they were meant to get access.
    if (user.user_metadata?.role !== 'agent') {
      await supabaseServer.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, role: 'agent' },
      });
    }

    const { error: grantError } = await supabaseServer
      .from('transaction_agents')
      .upsert(
        { transaction_id: transactionId, agent_user_id: user.id, invited_by: invite.invited_by },
        { onConflict: 'transaction_id,agent_user_id', ignoreDuplicates: true }
      );
    if (grantError) throw grantError;

    if (invite.status !== 'accepted') {
      await supabaseServer
        .from('agent_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id);
    }

    return NextResponse.json({ status: 'accepted', transactionId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error accepting agent invite:', error);
    return NextResponse.json({ error: 'Failed to accept invite' }, { status: 500 });
  }
}
