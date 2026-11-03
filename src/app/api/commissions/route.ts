import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { activeLinkForAgent, agentLabels, assertBrokerageOwner, brokerageOn, canOverseeDeal, listOwnerLinks, overseesAgent } from '@/lib/oversight';
import { CLOSED_STAGE } from '@/lib/oversightMath';
import { oversightError } from '@/lib/oversightServer';
import { cleanDeductions, computeSplit, isSplitType, SplitError, splitLabel, toCents, type SplitType } from '@/lib/commissionMath';
import { commissionForTransaction, isMissingTable, nextStatementNumber, notifyCommission, viewOf, breakdown, type CommissionRow } from '@/lib/commissions';

// Commission splits between a brokerage owner and their agents, one per deal. Off (404) unless the brokerage feature is on.
//
//   GET ?transaction=<id>   -> { role, canPropose, defaultSplit, dealClosed, commission }   for the deal's box (role is null for anyone else)
//   GET                     -> { asOwner, asAgent, agents }   the ledger; the owner's also lists agents with their default split
//   GET ?format=csv         -> the owner's ledger as a CSV
//   POST                    -> the owner proposes (or revises) the split on one deal: { transactionId, gross, splitType?, splitValue?, deductions? }
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
      const row = await commissionForTransaction(transactionId);
      const dealClosed = tx.status === CLOSED_STAGE;
      if (tx.tc_user_id === user.id) {
        // The agent who owns the deal sees it only if there is a commission on it (or a brokerage that could propose one).
        if (row) return NextResponse.json({ role: 'agent', canPropose: false, dealClosed, commission: viewOf(row) });
        // No statement yet: an agent in a brokerage can generate one, pre-filled with the split their brokerage set for them.
        const link = await activeLinkForAgent(user.id);
        if (!link || !(await overseesAgent(link.owner_user_id, user.id))) return NextResponse.json({ role: null, canPropose: false, dealClosed, commission: null });
        const owner = (await agentLabels([link.owner_user_id])).get(link.owner_user_id);
        const split = link.default_split_type && link.default_split_value !== null && link.default_split_value !== undefined ? { type: link.default_split_type as SplitType, value: Number(link.default_split_value) } : null;
        return NextResponse.json({ role: null, canPropose: false, canGenerate: true, brokerage: { name: owner?.name ?? 'Your brokerage', email: owner?.email ?? null }, defaultSplit: split, purchasePrice: Number(tx.purchase_price) || null, dealClosed, commission: null });
      }
      const owns = row ? row.owner_user_id === user.id : false;
      const oversees = await canOverseeDeal(user.id, transactionId);
      if (!owns && !oversees) return NextResponse.json({ role: null });
      let defaultSplit: { type: SplitType; value: number } | null = null;
      if (oversees) {
        const { data: link } = await supabaseServer.from('brokerage_links').select('default_split_type, default_split_value').eq('owner_user_id', user.id).eq('agent_user_id', tx.tc_user_id).eq('status', 'active').maybeSingle();
        if (link?.default_split_type && link.default_split_value !== null) defaultSplit = { type: link.default_split_type as SplitType, value: Number(link.default_split_value) };
      }
      return NextResponse.json({ role: 'owner', canPropose: oversees && (!row || (row.status !== 'paid')), defaultSplit, dealClosed, commission: row ? viewOf(row) : null });
    }

    const [mine, theirs] = await Promise.all([
      supabaseServer.from('deal_commissions').select('*').eq('owner_user_id', user.id).order('proposed_at', { ascending: false }).limit(1000),
      supabaseServer.from('deal_commissions').select('*').eq('agent_user_id', user.id).order('proposed_at', { ascending: false }).limit(500),
    ]);
    if (mine.error) throw mine.error;
    if (theirs.error) throw theirs.error;
    const ownerRows = (mine.data ?? []) as CommissionRow[];
    const agentRows = (theirs.data ?? []) as CommissionRow[];

    const txIds = [...new Set([...ownerRows, ...agentRows].map((r) => r.transaction_id))];
    const deals = new Map<string, { address: string | null; fileNumber: string | null; status: string | null }>();
    for (let i = 0; i < txIds.length; i += 80) {
      const { data } = await supabaseServer.from('transactions').select('id, property_address, file_number, status').in('id', txIds.slice(i, i + 80));
      for (const t of data ?? []) deals.set(t.id as string, { address: t.property_address as string | null, fileNumber: t.file_number as string | null, status: t.status as string | null });
    }
    const labels = await agentLabels([...ownerRows.map((r) => r.agent_user_id), ...agentRows.map((r) => r.owner_user_id)]);
    const dealOf = (id: string) => deals.get(id) ?? { address: null, fileNumber: null, status: null };

    const asOwner = ownerRows.map((r) => ({ ...viewOf(r), property: dealOf(r.transaction_id).address, fileNumber: dealOf(r.transaction_id).fileNumber, dealStatus: dealOf(r.transaction_id).status, agent: labels.get(r.agent_user_id) ?? { id: r.agent_user_id, name: 'Agent', email: null } }));
    const asAgent = agentRows.map((r) => ({ ...viewOf(r), property: dealOf(r.transaction_id).address, fileNumber: dealOf(r.transaction_id).fileNumber, dealStatus: dealOf(r.transaction_id).status, brokerage: labels.get(r.owner_user_id) ?? { id: r.owner_user_id, name: 'Brokerage', email: null } }));

    if (params.get('format') === 'csv') {
      if (ownerRows.length === 0 && !(await listOwnerLinks(user.id)).length) throw new AuthError('Not found', 404);
      const header = ['Statement', 'Agent', 'Agent email', 'Property', 'File number', 'Stage', 'Gross commission', 'Split', 'Fees', 'Net to agent', 'Net to brokerage', 'Status', 'Paid on'];
      const lines = [header.map(csvCell).join(',')];
      for (const c of asOwner) lines.push([c.statementNumber, c.agent.name, c.agent.email, c.property, c.fileNumber, c.dealStatus, c.gross.toFixed(2), splitLabel(c.splitType, c.splitValue), c.deductionsTotal.toFixed(2), c.agentNet.toFixed(2), c.brokerageNet.toFixed(2), c.status, c.paidOn].map(csvCell).join(','));
      await logAudit(request, user, 'commission.export', { entityType: 'commission', metadata: { rows: asOwner.length } });
      return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="commissions-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
    }

    // The owner also gets the roster of agents with their default split, so it can be edited on the same screen.
    let agents: { linkId: string; id: string; name: string; email: string | null; defaultSplit: { type: SplitType; value: number } | null }[] = [];
    if (ownerRows.length > 0 || (await listOwnerLinks(user.id)).length > 0) {
      const { data: links } = await supabaseServer.from('brokerage_links').select('id, agent_user_id, invited_email, default_split_type, default_split_value').eq('owner_user_id', user.id).eq('status', 'active');
      const names = await agentLabels((links ?? []).map((l) => l.agent_user_id as string));
      agents = (links ?? []).map((l) => ({ linkId: l.id as string, id: l.agent_user_id as string, name: names.get(l.agent_user_id as string)?.name ?? (l.invited_email as string), email: names.get(l.agent_user_id as string)?.email ?? (l.invited_email as string), defaultSplit: l.default_split_type && l.default_split_value !== null ? { type: l.default_split_type as SplitType, value: Number(l.default_split_value) } : null }));
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
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const transactionId = typeof input.transactionId === 'string' ? input.transactionId : '';
    if (!transactionId) return NextResponse.json({ error: 'Choose a deal.' }, { status: 400 });
    if (!(await canOverseeDeal(user.id, transactionId))) throw new AuthError('Not found', 404);

    const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, property_address').eq('id', transactionId).single();
    const agentId = tx!.tc_user_id as string;
    if (!(await overseesAgent(user.id, agentId))) throw new AuthError('Not found', 404);

    const gross = typeof input.gross === 'number' ? input.gross : Number(input.gross);

    // Use the agent's default split unless this deal says otherwise.
    let splitType = input.splitType;
    let splitValue = input.splitValue === undefined || input.splitValue === '' ? undefined : Number(input.splitValue);
    if (splitType === undefined || splitValue === undefined) {
      const { data: link } = await supabaseServer.from('brokerage_links').select('default_split_type, default_split_value').eq('owner_user_id', user.id).eq('agent_user_id', agentId).eq('status', 'active').maybeSingle();
      if (splitType === undefined) splitType = link?.default_split_type ?? undefined;
      if (splitValue === undefined && link?.default_split_value !== null && link?.default_split_value !== undefined) splitValue = Number(link.default_split_value);
    }
    if (!isSplitType(splitType) || splitValue === undefined) throw new SplitError('Choose how the commission is split, or set this agent’s default split first.');
    const deductions = cleanDeductions(input.deductions);
    const result = computeSplit({ gross, splitType, splitValue, deductions });

    const existing = await commissionForTransaction(transactionId);
    if (existing && existing.owner_user_id !== user.id) throw new AuthError('Not found', 404);
    if (existing && existing.status === 'paid') return NextResponse.json({ error: 'This commission was already paid. Void it first if it needs to change.' }, { status: 409 });

    const fields = {
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
      proposed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
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
          if (again) return NextResponse.json({ error: 'A split was just proposed on this deal. Reload and edit it instead.' }, { status: 409 });
          continue;
        }
        throw error;
      }
    }

    await logAudit(request, user, existing ? 'commission.revise' : 'commission.propose', { entityType: 'commission', entityId: row.id, metadata: { transactionId, splitType, splitValue, grossCents: row.gross_cents } });
    await notifyCommission({ recipientId: agentId, actorId: user.id, transactionId, title: `Your brokerage proposed a commission split · ${tx!.property_address ?? 'a deal'}`, link: `/dashboard/transactions/${transactionId}` });
    return NextResponse.json({ ...viewOf(row), summary: breakdown(row) }, { status: existing ? 200 : 201 });
  } catch (error) {
    return fail(error, 'save the commission');
  }
}
