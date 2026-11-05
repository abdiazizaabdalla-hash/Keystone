import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { activeLinkForAgent, assertWorkspaceAgent, brokerageOn, overseesAgent } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { SplitError } from '@/lib/commissionMath';
import { CLOSED_STAGE } from '@/lib/oversightMath';
import { commissionForTransaction, ensureEstimateStatement, isMissingTable, notifyCommission, termsFromLink, viewOf, breakdown } from '@/lib/commissions';

// An agent sends their commission invoice to their brokerage for one of their own deals, open or closed. There is no gross to enter:
// the invoice starts as an ESTIMATE built from the base terms their brokerage set for them (sale price x commission rate, split, fees),
// and the brokerage owner confirms the actual commission from the closing documents. It is the same record as the commission
// statement, so a deal never has two. Sending it again does nothing new. Nothing here moves money.

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    assertNotCollaborator(user);
    assertWorkspaceAgent(user);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const transactionId = typeof input.transactionId === 'string' ? input.transactionId : '';
    if (!transactionId) return NextResponse.json({ error: 'Choose a deal.' }, { status: 400 });

    const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, property_address, status').eq('id', transactionId).maybeSingle();
    if (!tx || tx.tc_user_id !== user.id) throw new AuthError('Not found', 404);

    const link = await activeLinkForAgent(user.id);
    if (!link || !(await overseesAgent(link.owner_user_id, user.id))) {
      return NextResponse.json({ error: 'You are not in a brokerage right now, so there is no one to send a commission statement to.' }, { status: 409 });
    }
    const existing = await commissionForTransaction(transactionId);
    if (existing) return NextResponse.json({ ...viewOf(existing), summary: breakdown(existing) }, { status: 200 });

    if (!termsFromLink(link).split) {
      throw new SplitError('Your brokerage has not set your commission terms yet. Ask them to set your base split, and you can send your commission invoice.');
    }
    const row = await ensureEstimateStatement(transactionId, { allowOpen: true });
    if (!row) throw new Error('Could not start the commission statement');

    await logAudit(request, user, 'commission.generate', { entityType: 'commission', entityId: row.id, metadata: { transactionId } });
    const closed = tx.status === CLOSED_STAGE;
    await notifyCommission({ recipientId: link.owner_user_id, actorId: user.id, transactionId, title: closed ? `${row.statement_number}: the agent sent a commission invoice · ${tx.property_address ?? 'a deal'}` : `${row.statement_number}: the agent sent a commission invoice before closing · ${tx.property_address ?? 'a deal'}. Confirm the actual commission when it closes.`, link: `/dashboard/collaborate/deals/${transactionId}` });
    return NextResponse.json({ ...viewOf(row), summary: breakdown(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof SplitError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (isMissingTable(error)) return NextResponse.json({ error: 'The database needs one more update before commissions work. Run add-brokerage-oversight.sql in Supabase.' }, { status: 500 });
    return oversightError(error, 'start the commission statement');
  }
}
