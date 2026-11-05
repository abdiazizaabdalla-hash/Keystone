import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { activeLinkForAgent, agentLabels, assertBrokerageOwner, brokerageOn, canOverseeDeal, listOwnerLinks, overseesAgent } from '@/lib/oversight';
import { CLOSED_STAGE } from '@/lib/oversightMath';
import { oversightError } from '@/lib/oversightServer';
import { cleanDeductions, cleanRate, grossPercentOfPrice, computeSplit, expectedGrossCents, isRateType, isSplitType, SplitError, splitLabel, toCents, type SplitType } from '@/lib/commissionMath';
import { capInfoFor, commissionForTransaction, ensureEstimateStatement, isMissingTable, nextStatementNumber, notifyCommission, termsFromLink, viewOf, breakdown, type BaseTerms, type CommissionRow } from '@/lib/commissions';

// Commission splits between a brokerage owner and their agents, one per deal. Off (404) unless the brokerage feature is on.
//
//   GET ?transaction=<id>   -> { role, canPropose, terms, cap, dealClosed, commission }   for the deal's box (role is null for anyone else).
//                              A deal with a brokerage that has set the agent's terms gets an ESTIMATE statement the first time it is looked at.
//   GET                     -> { asOwner, asAgent, agents }   the ledger; the owner's also lists agents with their default split
//   GET ?format=csv         -> the owner's ledger as a CSV
//   POST                    -> the owner, on one deal: { transactionId, gross?, splitType?, splitValue?, deductions? }
//                              with gross: confirms the actual gross commission (from the closing documents) and sends the statement to the agent
//                              without gross: saves the terms on the estimate (creating it if the agent had no terms when the deal started)
//
// Only the owner and that deal's agent can ever see a commission. Nothing here moves money.

const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function fail(error: unknown, what: string) {
  if (error instanceof SplitError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isMissingTable(error)) {
    console.error(`Error trying to ${what} (database not updated):`, error);
    return NextResponse.json({ error: 'The database needs one more update before commissions work. Run add-brokerage-oversight.sql in Supabase.' }, { status: 500 });
  }
  return oversightError(error, what);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const params = request.nextUrl.searchParams;
    const transactionId = params.get('transaction');

    if (transactionId) {
      const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, status, purchase_price').eq('id', transactionId).maybeSingle();
      if (!tx) return NextResponse.json({ role: null });
      const dealClosed = tx.status === CLOSED_STAGE;
      const today = new Date().toISOString().slice(0, 10);
      if (tx.tc_user_id === user.id) {
        // The agent who owns the deal. An estimate is made for them the first time they look, if their brokerage has set their terms.
        const found = await ensureEstimateStatement(transactionId);
        // A statement exists for a closed deal, or for an open one once the agent has sent their commission invoice.
        const row = found;
        const link = await activeLinkForAgent(user.id);
        const inBrokerage = !!link && (await overseesAgent(link.owner_user_id, user.id));
        const owner = link ? (await agentLabels([link.owner_user_id])).get(link.owner_user_id) : undefined;
        const brokerage = { name: owner?.name ?? 'Your brokerage', email: owner?.email ?? null };
        if (row) {
          const sameOwner = !!link && inBrokerage && link.owner_user_id === row.owner_user_id;
          const terms = sameOwner ? termsFromLink(link) : null;
          const cap = terms && terms.cap ? await capInfoFor(row.owner_user_id, user.id, terms, today) : null;
          return NextResponse.json({ role: 'agent', canPropose: false, dealClosed, brokerage: sameOwner ? brokerage : undefined, terms, cap, purchasePrice: Number(tx.purchase_price) || null, commission: viewOf(row) });
        }
        if (!inBrokerage) return NextResponse.json({ role: null, canPropose: false, dealClosed, commission: null });
        // In a brokerage that has not set their terms yet: nothing is invented, the card just says so.
        // Before closing nothing exists until the agent sends the invoice, which needs the brokerage's terms for them.
        if (!dealClosed) return NextResponse.json({ role: null, canPropose: false, dealClosed, canInvoice: !!termsFromLink(link).split, awaitingTerms: !termsFromLink(link).split, brokerage, commission: null });
        return NextResponse.json({ role: null, canPropose: false, awaitingTerms: true, brokerage, purchasePrice: Number(tx.purchase_price) || null, dealClosed, commission: null });
      }
      const existing = await commissionForTransaction(transactionId);
      const owns = existing ? existing.owner_user_id === user.id : false;
      const oversees = await canOverseeDeal(user.id, transactionId);
      if (!owns && !oversees) return NextResponse.json({ role: null });
      const found = oversees ? await ensureEstimateStatement(transactionId) : existing;
      const row = found;
      let terms: BaseTerms | null = null;
      let cap = null;
      if (oversees) {
        const { data: link } = await supabaseServer.from('brokerage_links').select('*').eq('owner_user_id', user.id).eq('agent_user_id', tx.tc_user_id).eq('status', 'active').maybeSingle();
        terms = termsFromLink(link);
        if (terms.cap) cap = await capInfoFor(user.id, tx.tc_user_id as string, terms, today);
      }
      return NextResponse.json({
        role: 'owner',
        canPropose: oversees && (dealClosed || (!!row && row.status !== 'estimate')) && (!row || row.status !== 'paid'),
        defaultSplit: terms?.split ?? null,
        terms,
        cap,
        dealClosed,
        purchasePrice: Number(tx.purchase_price) || null,
        commission: row ? viewOf(row) : null,
      });
    }

    const [mine, theirs] = await Promise.all([
      supabaseServer.from('deal_commissions').select('*').eq('owner_user_id', user.id).order('proposed_at', { ascending: false }).limit(1000),
      supabaseServer.from('deal_commissions').select('*').eq('agent_user_id', user.id).order('proposed_at', { ascending: false }).limit(500),
    ]);
    if (mine.error) throw mine.error;
    if (theirs.error) throw theirs.error;
    const allOwnerRows = (mine.data ?? []) as CommissionRow[];
    const allAgentRows = (theirs.data ?? []) as CommissionRow[];

    const txIds = [...new Set([...allOwnerRows, ...allAgentRows].map((r) => r.transaction_id))];
    const deals = new Map<string, { address: string | null; fileNumber: string | null; status: string | null; price: number | null }>();
    for (let i = 0; i < txIds.length; i += 80) {
      const { data } = await supabaseServer.from('transactions').select('id, property_address, file_number, status, purchase_price').in('id', txIds.slice(i, i + 80));
      for (const t of data ?? []) deals.set(t.id as string, { address: t.property_address as string | null, fileNumber: t.file_number as string | null, status: t.status as string | null, price: t.purchase_price ? Number(t.purchase_price) : null });
    }
    const visible = (_r: CommissionRow) => true;
    const ownerRows = allOwnerRows.filter(visible);
    const agentRows = allAgentRows.filter(visible);
    const labels = await agentLabels([...ownerRows.map((r) => r.agent_user_id), ...agentRows.map((r) => r.owner_user_id)]);
    const dealOf = (id: string) => deals.get(id) ?? { address: null, fileNumber: null, status: null, price: null };

    const asOwner = ownerRows.map((r) => ({ ...viewOf(r), property: dealOf(r.transaction_id).address, fileNumber: dealOf(r.transaction_id).fileNumber, dealStatus: dealOf(r.transaction_id).status, salePrice: dealOf(r.transaction_id).price, grossPercent: grossPercentOfPrice(dealOf(r.transaction_id).price, r.gross_cents === null ? null : Number(r.gross_cents)), agent: labels.get(r.agent_user_id) ?? { id: r.agent_user_id, name: 'Agent', email: null } }));
    const asAgent = agentRows.map((r) => ({ ...viewOf(r), property: dealOf(r.transaction_id).address, fileNumber: dealOf(r.transaction_id).fileNumber, dealStatus: dealOf(r.transaction_id).status, salePrice: dealOf(r.transaction_id).price, grossPercent: grossPercentOfPrice(dealOf(r.transaction_id).price, r.gross_cents === null ? null : Number(r.gross_cents)), brokerage: labels.get(r.owner_user_id) ?? { id: r.owner_user_id, name: 'Brokerage', email: null } }));

    if (params.get('format') === 'csv') {
      const money = (n: number | null) => (n === null ? '' : n.toFixed(2));
      if (ownerRows.length === 0 && !(await listOwnerLinks(user.id)).length) throw new AuthError('Not found', 404);
      const header = ['Statement', 'Agent', 'Agent email', 'Property', 'File number', 'Stage', 'Gross commission', 'Split', 'Fees', 'Net to agent', 'Net to brokerage', 'Status', 'Paid on'];
      const lines = [header.map(csvCell).join(',')];
      for (const c of asOwner) lines.push([c.statementNumber, c.agent.name, c.agent.email, c.property, c.fileNumber, c.dealStatus, money(c.gross), splitLabel(c.splitType, c.splitValue), money(c.deductionsTotal), money(c.agentNet), money(c.brokerageNet), c.grossStatus === 'estimate' ? 'estimate' : c.status, c.paidOn].map(csvCell).join(','));
      await logAudit(request, user, 'commission.export', { entityType: 'commission', metadata: { rows: asOwner.length } });
      return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="commissions-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
    }

    // The owner also gets the roster of agents with their default split, so it can be edited on the same screen.
    let agents: { linkId: string; id: string; name: string; email: string | null; defaultSplit: { type: SplitType; value: number } | null; terms: BaseTerms }[] = [];
    if (ownerRows.length > 0 || (await listOwnerLinks(user.id)).length > 0) {
      const { data: links } = await supabaseServer.from('brokerage_links').select('*').eq('owner_user_id', user.id).eq('status', 'active');
      const names = await agentLabels((links ?? []).map((l) => l.agent_user_id as string));
      agents = (links ?? []).map((l) => ({ linkId: l.id as string, id: l.agent_user_id as string, name: names.get(l.agent_user_id as string)?.name ?? (l.invited_email as string), email: names.get(l.agent_user_id as string)?.email ?? (l.invited_email as string), defaultSplit: l.default_split_type && l.default_split_value !== null ? { type: l.default_split_type as SplitType, value: Number(l.default_split_value) } : null, terms: termsFromLink(l) }));
    }
    return NextResponse.json({ asOwner, asAgent, agents });
  } catch (error) {
    return fail(error, 'load commissions');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    await assertBrokerageManageable(user.id);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const transactionId = typeof input.transactionId === 'string' ? input.transactionId : '';
    if (!transactionId) return NextResponse.json({ error: 'Choose a deal.' }, { status: 400 });
    if (!(await canOverseeDeal(user.id, transactionId))) throw new AuthError('Not found', 404);

    const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, property_address, status, purchase_price').eq('id', transactionId).single();
    const agentId = tx!.tc_user_id as string;
    if (!(await overseesAgent(user.id, agentId))) throw new AuthError('Not found', 404);

    const hasGross = input.gross !== undefined && input.gross !== null && input.gross !== '';
    const gross = typeof input.gross === 'number' ? input.gross : Number(input.gross);

    // The agent's base terms are the starting point; anything sent for this deal wins.
    const { data: link } = await supabaseServer.from('brokerage_links').select('*').eq('owner_user_id', user.id).eq('agent_user_id', agentId).eq('status', 'active').maybeSingle();
    const terms = termsFromLink(link);
    const existing = await commissionForTransaction(transactionId);
    if (existing && existing.owner_user_id !== user.id) throw new AuthError('Not found', 404);
    if ((!existing || existing.status === 'estimate') && tx!.status !== CLOSED_STAGE) return NextResponse.json({ error: 'Commission opens when the deal closes.' }, { status: 409 });
    if (existing && existing.status === 'paid') return NextResponse.json({ error: 'This commission was already paid. Void it first if it needs to change.' }, { status: 409 });

    let splitType = input.splitType;
    let splitValue = input.splitValue === undefined || input.splitValue === '' ? undefined : Number(input.splitValue);
    if (splitType === undefined || splitValue === undefined) {
      if (existing) {
        if (splitType === undefined) splitType = existing.split_type;
        if (splitValue === undefined) splitValue = Number(existing.split_value);
      } else {
        if (splitType === undefined) splitType = terms.split?.type;
        if (splitValue === undefined) splitValue = terms.split?.value;
      }
    }
    if (!isSplitType(splitType) || splitValue === undefined) throw new SplitError('Choose how the commission is split, or set this agent’s base split first.');
    // With no gross yet nothing is computed, so the split is checked here (a confirmed statement is checked again by the math).
    if (!Number.isFinite(splitValue) || splitValue < 0 || (splitType === 'percent' && splitValue > 100) || splitValue > 100_000_000) throw new SplitError(splitType === 'percent' ? 'A percentage must be between 0 and 100.' : 'Enter an amount of zero or more.');
    // The commission rate (a percent of the sale price, or a flat fee): this deal's own if sent, else what the statement already has, else the agent's base rate.
    let rate = existing?.commission_type && isRateType(existing.commission_type) && existing.commission_value !== null && existing.commission_value !== undefined ? { type: existing.commission_type, value: Number(existing.commission_value) } : terms.commission;
    if (input.commissionType !== undefined || input.commissionValue !== undefined) {
      if (input.commissionType === null || input.commissionValue === null || input.commissionValue === '') rate = null;
      else rate = cleanRate(input.commissionType ?? rate?.type, input.commissionValue ?? rate?.value);
    }
    const price = tx!.purchase_price === null || tx!.purchase_price === undefined ? null : Number(tx!.purchase_price);
    const deductions = input.deductions !== undefined ? cleanDeductions(input.deductions) : existing ? existing.deductions ?? [] : terms.fees.map((f) => ({ label: f.label, amount: f.amount }));
    const now = new Date().toISOString();
    const capSnapshot = existing?.cap_snapshot ?? terms.cap;

    let fields: Record<string, unknown>;
    let confirming = false;
    if (hasGross) {
      // The owner confirms the actual gross commission. From here it is a statement the agent can review.
      const result = computeSplit({ gross, splitType, splitValue, deductions });
      confirming = true;
      fields = {
        owner_user_id: user.id,
        agent_user_id: agentId,
        gross_cents: toCents(gross),
        split_type: splitType,
        split_value: splitValue,
        deductions,
        agent_net_cents: result.agentNetCents,
        brokerage_net_cents: result.brokerageNetCents,
        status: 'proposed',
        change_note: null,
        accepted_at: null,
        proposed_at: now,
        confirmed_at: now,
        confirmed_by: user.id,
        commission_type: rate?.type ?? null,
        commission_value: rate?.value ?? null,
        cap_snapshot: capSnapshot,
        updated_at: now,
      };
    } else {
      // No figures yet: just the terms. A statement the owner already confirmed keeps its figures and needs a gross to change.
      if (existing && existing.status !== 'estimate' && existing.status !== 'void') throw new SplitError('Enter the gross commission to change a confirmed statement.');
      fields = {
        owner_user_id: user.id,
        agent_user_id: agentId,
        gross_cents: null,
        split_type: splitType,
        split_value: splitValue,
        deductions,
        agent_net_cents: null,
        brokerage_net_cents: null,
        status: 'estimate',
        change_note: null,
        commission_type: rate?.type ?? null,
        commission_value: rate?.value ?? null,
        estimated_gross_cents: expectedGrossCents(price, rate),
        cap_snapshot: capSnapshot,
        updated_at: now,
      };
    }
    let row: CommissionRow;
    if (existing) {
      const { data, error } = await supabaseServer.from('deal_commissions').update(fields).eq('id', existing.id).select('*').single();
      if (error) throw error;
      row = data as CommissionRow;
    } else {
      // A second proposal at the same moment would collide on the statement number; try again once.
      let attempt = 0;
      for (;;) {
        const { data, error } = await supabaseServer.from('deal_commissions').insert({ ...fields, transaction_id: transactionId, statement_number: await nextStatementNumber(user.id) }).select('*').single();
        if (!error) {
          row = data as CommissionRow;
          break;
        }
        if (error.code === '23505' && attempt++ < 2) {
          const again = await commissionForTransaction(transactionId);
          if (again) return NextResponse.json({ error: 'A commission was just started on this deal. Reload and edit it instead.' }, { status: 409 });
          continue;
        }
        throw error;
      }
    }

    await logAudit(request, user, confirming ? (existing && existing.status !== 'estimate' ? 'commission.revise' : 'commission.confirm') : 'commission.terms', { entityType: 'commission', entityId: row.id, metadata: { transactionId, splitType, splitValue, grossCents: row.gross_cents } });
    if (confirming) {
      const revised = !!existing && existing.status !== 'estimate' && existing.status !== 'void';
      await notifyCommission({ recipientId: agentId, actorId: user.id, transactionId, title: `${revised ? 'Your brokerage revised' : 'Your brokerage confirmed'} the commission statement · ${tx!.property_address ?? 'a deal'}`, link: `/dashboard/transactions/${transactionId}`, email: { source: 'commission_confirmed', subject: `${revised ? 'Your commission statement was revised' : 'Your commission was confirmed'} · ${tx!.property_address ?? 'a deal'}`, paragraphs: [`Your brokerage ${revised ? 'revised' : 'confirmed'} the commission statement for ${tx!.property_address ?? 'a deal'} (${row.statement_number}).`, 'Review it, and agree or ask for a change, on the deal.'], linkLabel: 'Review the statement' } });
    }
    return NextResponse.json({ ...viewOf(row), summary: breakdown(row) }, { status: existing ? 200 : 201 });
  } catch (error) {
    return fail(error, 'save the commission');
  }
}
