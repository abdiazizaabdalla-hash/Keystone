import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// PATCH /api/signing-requests/[id] -- lets the TC void a signing request
// they sent, as long as it's still pending. Added 2026-09: previously
// there was no way to undo "Send for Signature" at all -- a typo'd
// email, a dead deal, or an unresponsive signer left the request stuck
// forever with no recourse but editing the database by hand.
//
// Write access stays owner-only (not team-wide) -- same convention as
// every other mutation in this codebase (creating/deleting a
// transaction, an agent, an invoice): a Team owner can SEE a teammate's
// signing requests (see the GET route), but voiding one is scoped to
// whoever's account it actually belongs to.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);

    const body = await request.json().catch(() => ({}));
    if (body?.action !== 'void') {
      return NextResponse.json({ error: "action must be 'void'" }, { status: 400 });
    }

    const { data: signingRequest, error: fetchError } = await supabaseServer
      .from('signing_requests')
      .select('id, transaction_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !signingRequest) {
      return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });
    }

    const { data: transaction } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', signingRequest.transaction_id)
      .single();

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .eq('tc_user_id', user.id)
        .single();
      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to void this request' }, { status: 403 });
      }
    }

    if (signingRequest.status !== 'pending') {
      return NextResponse.json(
        { error: `This request is already ${signingRequest.status} and can't be voided.` },
        { status: 409 }
      );
    }

    const voidedAtIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseServer
      .from('signing_requests')
      .update({ status: 'voided', voided_at: voidedAtIso, updated_at: voidedAtIso })
      .eq('id', id)
      .select('id, status')
      .single();

    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error voiding signing request:', error);
    return NextResponse.json({ error: 'Failed to void signing request' }, { status: 500 });
  }
}
