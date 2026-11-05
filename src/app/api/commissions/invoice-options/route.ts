import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { activeLinkForAgent, agentLabels, assertWorkspaceAgent, brokerageOn, overseesAgent } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { CLOSED_STAGE } from '@/lib/oversightMath';
import { capInfoFor, invoicePreview, isMissingTable, termsFromLink, viewOf, type CommissionRow } from '@/lib/commissions';

// What the agent needs to send a commission invoice to their brokerage: who it goes to (their brokerage, never typed in), which of
// their deals it can be for (open or closed), and for each deal the whole calculation worked out from the brokerage's terms for them
// (sale price x commission rate, split, fees) or, once an invoice exists for the deal, that invoice as it stands.
// Everything is read from what the brokerage set. The agent cannot change any of it here.

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    assertNotCollaborator(user);
    assertWorkspaceAgent(user);

    const link = await activeLinkForAgent(user.id);
    if (!link || !(await overseesAgent(link.owner_user_id, user.id))) return NextResponse.json({ inBrokerage: false });

    const owner = (await agentLabels([link.owner_user_id])).get(link.owner_user_id);
    const terms = termsFromLink(link);
    const today = new Date().toISOString().slice(0, 10);
    const cap = terms.cap ? await capInfoFor(link.owner_user_id, user.id, terms, today) : null;

    const { data: txs, error } = await supabaseServer
      .from('transactions')
      .select('id, property_address, file_number, status, purchase_price, closing_date')
      .eq('tc_user_id', user.id)
      .order('closing_date', { ascending: true, nullsFirst: false })
      .limit(300);
    if (error) throw error;

    const ids = (txs ?? []).map((t) => t.id as string);
    const statements = new Map<string, CommissionRow>();
    for (let i = 0; i < ids.length; i += 80) {
      const { data } = await supabaseServer.from('deal_commissions').select('*').in('transaction_id', ids.slice(i, i + 80));
      for (const r of (data ?? []) as CommissionRow[]) statements.set(r.transaction_id, r);
    }

    const deals = [];
    for (const t of txs ?? []) {
      const statement = statements.get(t.id as string) ?? null;
      // A statement belongs to one brokerage; one from a brokerage the agent has since left is not theirs to invoice.
      if (statement && statement.owner_user_id !== link.owner_user_id) continue;
      const price = t.purchase_price === null || t.purchase_price === undefined ? null : Number(t.purchase_price);
      deals.push({
        id: t.id as string,
        address: (t.property_address as string | null) ?? null,
        fileNumber: (t.file_number as string | null) ?? null,
        status: (t.status as string | null) ?? null,
        closed: t.status === CLOSED_STAGE,
        closingDate: (t.closing_date as string | null) ?? null,
        purchasePrice: price,
        statement: statement && statement.status !== 'void' ? viewOf(statement) : null,
        preview: statement && statement.status !== 'void' ? null : invoicePreview(price, terms),
      });
    }
    // Deals still to invoice first (open, soonest closing), then ones already sent.
    deals.sort((a, b) => Number(!!a.statement) - Number(!!b.statement) || Number(a.closed) - Number(b.closed));

    return NextResponse.json({
      inBrokerage: true,
      brokerage: { name: owner?.name ?? 'Your brokerage', email: owner?.email ?? null },
      termsSet: !!terms.split,
      terms: { commission: terms.commission, split: terms.split, fees: terms.fees },
      cap,
      deals,
    });
  } catch (error) {
    if (isMissingTable(error)) return NextResponse.json({ inBrokerage: false });
    return oversightError(error, 'load your commission invoice options');
  }
}
