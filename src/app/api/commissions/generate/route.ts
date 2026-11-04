import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { activeLinkForAgent, assertWorkspaceAgent, brokerageOn, overseesAgent } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { computeSplit, isSplitType, SplitError, toCents } from '@/lib/commissionMath';
import { commissionForTransaction, isMissingTable, nextStatementNumber, notifyCommission, viewOf, breakdown, type CommissionRow } from '@/lib/commissions';

// An agent generates the commission invoice for one of their own deals. It is filled in from their brokerage's default
// split for them; the only number they supply is the gross commission. It goes to the brokerage as "needs your approval"
// (a change request with no note, see viewOf): the brokerage approves it as it is, or edits it and the agent agrees again.
// Nothing here moves money.

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    assertNotCollaborator(user);
    assertWorkspaceAgent(user);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const transactionId = typeof input.transactionId === 'string' ? input.transactionId : '';
    if (!transactionId) return NextResponse.json({ error: 'Choose a deal.' }, { status: 400 });

    const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, property_address').eq('id', transactionId).maybeSingle();
    if (!tx || tx.tc_user_id !== user.id) throw new AuthError('Not found', 404);

    const link = await activeLinkForAgent(user.id);
    if (!link || !(await overseesAgent(link.owner_user_id, user.id))) {
      return NextResponse.json({ error: 'You are not in a brokerage right now, so there is no one to send a commission invoice to.' }, { status: 409 });
    }
    if (await commissionForTransaction(transactionId)) {
      return NextResponse.json({ error: 'There is already a commission statement for this deal.' }, { status: 409 });
    }

    const splitType = link.default_split_type;
    const splitValue = link.default_split_value === null || link.default_split_value === undefined ? undefined : Number(link.default_split_value);
    if (!isSplitType(splitType) || splitValue === undefined) {
      throw new SplitError('Your brokerage has not set your split yet. Ask them to set it, or to propose the split on this deal.');
    }
    const gross = typeof input.gross === 'number' ? input.gross : Number(input.gross);
    const result = computeSplit({ gross, splitType, splitValue, deductions: [] });

    let row: CommissionRow | null = null;
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      const { data, error } = await supabaseServer
        .from('deal_commissions')
        .insert({
          transaction_id: transactionId,
          owner_user_id: link.owner_user_id,
          agent_user_id: user.id,
          statement_number: await nextStatementNumber(link.owner_user_id),
          gross_cents: toCents(gross),
          split_type: splitType,
          split_value: splitValue,
          deductions: [],
          agent_net_cents: result.agentNetCents,
          brokerage_net_cents: result.brokerageNetCents,
          status: 'change_requested',
          change_note: null,
        })
        .select('*')
        .single();
      if (!error) row = data as CommissionRow;
      else if (error.code !== '23505') throw error;
      else if (await commissionForTransaction(transactionId)) return NextResponse.json({ error: 'There is already a commission statement for this deal.' }, { status: 409 });
    }
    if (!row) throw new Error('Could not number the statement');

    await logAudit(request, user, 'commission.generate', { entityType: 'commission', entityId: row.id, metadata: { transactionId, grossCents: row.gross_cents } });
    await notifyCommission({ recipientId: link.owner_user_id, actorId: user.id, transactionId, title: `${row.statement_number}: a commission invoice needs your approval · ${tx.property_address ?? 'a deal'}`, link: `/dashboard/collaborate/deals/${transactionId}` });
    return NextResponse.json({ ...viewOf(row), summary: breakdown(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof SplitError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (isMissingTable(error)) return NextResponse.json({ error: 'The database needs one more update before commissions work. Run add-brokerage-oversight.sql in Supabase.' }, { status: 500 });
    return oversightError(error, 'generate the commission invoice');
  }
}
