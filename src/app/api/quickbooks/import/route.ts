import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { logAudit } from '@/lib/audit';
import { normName, relayInvoiceNumber, textMentionsDeal } from '@/lib/quickbooks';

// Bring invoices from a QuickBooks export into Relay. The browser reads the file and sends clean rows; nothing is
// saved until the TC confirms.
//   mode "preview": match each row to one of THIS TC's agents and an unbilled deal, flag duplicates. Saves nothing.
//   mode "commit":  re-checks every choice on the server and creates the invoices. Existing invoices are never changed.
// An invoice in Relay always belongs to a deal (one per deal), so a row with no deal chosen is skipped, not guessed.

const MAX_ROWS = 500;
const MAX_AMOUNT = 10_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

interface InRow {
  number: string;
  customer: string;
  amount: number;
  date: string;
  due: string;
  balance: number | null;
  text: string;
  paid_date: string;
}

async function loadScope(userId: string) {
  const { data: agents } = await supabaseServer.from('agents').select('id, name, email').eq('tc_user_id', userId).limit(5000);
  const agentList = agents || [];
  const agentIds = agentList.map((a) => a.id as string);
  const { data: txs } = agentIds.length
    ? await supabaseServer.from('transactions').select('id, agent_id, file_number, property_address').in('agent_id', agentIds).limit(5000)
    : { data: [] as { id: string; agent_id: string; file_number: string; property_address: string }[] };
  const txList = txs || [];
  const txIds = txList.map((t) => t.id as string);
  const billed = new Set<string>();
  for (let i = 0; i < txIds.length; i += 200) {
    const { data } = await supabaseServer.from('invoices').select('transaction_id').in('transaction_id', txIds.slice(i, i + 200));
    for (const r of data || []) billed.add(r.transaction_id as string);
  }
  return { agentList, txList, billed };
}

async function existingNumbers(numbers: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < numbers.length; i += 200) {
    const { data } = await supabaseServer.from('invoices').select('invoice_number').in('invoice_number', numbers.slice(i, i + 200));
    for (const r of data || []) out.add(String(r.invoice_number).toLowerCase());
  }
  return out;
}

function matchAgent(customer: string, agents: { id: string; name: string; email: string | null }[]): string | null {
  const c = normName(customer);
  if (!c) return null;
  const swapped = customer.includes(',') ? normName(customer.split(',').slice(1).join(' ') + ' ' + customer.split(',')[0]) : '';
  const exact = agents.filter((a) => normName(a.name) === c || (swapped && normName(a.name) === swapped));
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  const email = customer.match(/[^\s<>]+@[^\s<>]+/)?.[0]?.toLowerCase();
  if (email) {
    const byEmail = agents.filter((a) => (a.email || '').toLowerCase() === email);
    if (byEmail.length === 1) return byEmail[0].id;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'commit' ? 'commit' : 'preview';
    const rawRows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
    if (rawRows.length === 0) return NextResponse.json({ error: 'No invoices to import' }, { status: 400 });
    if (rawRows.length > MAX_ROWS) return NextResponse.json({ error: `Import up to ${MAX_ROWS} invoices at a time` }, { status: 400 });

    const { agentList, txList, billed } = await loadScope(user.id);

    if (mode === 'preview') {
      const rows: InRow[] = [];
      for (const r of rawRows) {
        const o = (r || {}) as Record<string, unknown>;
        const amount = Number(o.amount);
        if (!str(o.number) || !Number.isFinite(amount) || amount <= 0) continue;
        rows.push({
          number: str(o.number, 100),
          customer: str(o.customer),
          amount,
          date: DATE_RE.test(str(o.date, 10)) ? str(o.date, 10) : '',
          due: DATE_RE.test(str(o.due, 10)) ? str(o.due, 10) : '',
          balance: typeof o.balance === 'number' && Number.isFinite(o.balance) ? o.balance : null,
          text: str(o.text, 600),
          paid_date: DATE_RE.test(str(o.paid_date, 10)) ? str(o.paid_date, 10) : '',
        });
      }
      const used = await existingNumbers(rows.map((r) => relayInvoiceNumber(r.number)));
      const claimed = new Set<string>();
      const preview = rows.map((r) => {
        const relayNumber = relayInvoiceNumber(r.number);
        if (used.has(relayNumber.toLowerCase())) return { ...r, relayNumber, status: 'duplicate' as const, agentId: null, transactionId: null };
        const agentId = matchAgent(r.customer, agentList.map((a) => ({ id: a.id as string, name: a.name as string, email: (a.email as string | null) ?? null })));
        let transactionId: string | null = null;
        if (agentId) {
          const open = txList.filter((t) => t.agent_id === agentId && !billed.has(t.id as string) && !claimed.has(t.id as string));
          const hits = open.filter((t) => textMentionsDeal(r.text, { file_number: t.file_number as string, property_address: t.property_address as string }));
          if (hits.length === 1) transactionId = hits[0].id as string;
          else if (hits.length === 0 && open.length === 1 && !r.text) transactionId = null; // never guess from "only one open deal"
        }
        if (transactionId) claimed.add(transactionId);
        return { ...r, relayNumber, status: agentId && transactionId ? ('ready' as const) : ('needs_match' as const), agentId, transactionId };
      });
      return NextResponse.json({
        rows: preview,
        agents: agentList.map((a) => ({ id: a.id, name: a.name })),
        deals: txList
          .filter((t) => !billed.has(t.id as string))
          .map((t) => ({ id: t.id, agent_id: t.agent_id, file_number: t.file_number, property_address: t.property_address })),
      });
    }

    // ---- commit ----
    const agentIds = new Set(agentList.map((a) => a.id as string));
    const txById = new Map(txList.map((t) => [t.id as string, t]));
    const usedTx = new Set<string>();
    const nums = rawRows.map((r) => relayInvoiceNumber(str((r as Record<string, unknown>)?.number, 100))).filter(Boolean);
    const taken = await existingNumbers(nums);

    let dueDays = 30;
    const { data: tcUser } = await supabaseServer.auth.admin.getUserById(user.id);
    const configured = tcUser?.user?.user_metadata?.invoice_due_days;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) dueDays = configured;

    const created: string[] = [];
    const skipped: { number: string; reason: string }[] = [];
    for (const r of rawRows) {
      const o = (r || {}) as Record<string, unknown>;
      const number = str(o.number, 100);
      const relayNumber = relayInvoiceNumber(number);
      const fail = (reason: string) => skipped.push({ number: number || '(no number)', reason });
      if (!number) {
        fail('No invoice number');
        continue;
      }
      const amount = Number(o.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        fail('Amount is not valid');
        continue;
      }
      const agentId = str(o.agentId, 64);
      const transactionId = str(o.transactionId, 64);
      if (!agentIds.has(agentId)) {
        fail('No agent chosen');
        continue;
      }
      const tx = txById.get(transactionId);
      if (!tx || tx.agent_id !== agentId) {
        fail('No deal chosen for that agent');
        continue;
      }
      if (billed.has(transactionId) || usedTx.has(transactionId)) {
        fail('That deal already has an invoice');
        continue;
      }
      if (taken.has(relayNumber.toLowerCase())) {
        fail('Already in Relay');
        continue;
      }

      const date = DATE_RE.test(str(o.date, 10)) ? str(o.date, 10) : new Date().toISOString().split('T')[0];
      let due = DATE_RE.test(str(o.due, 10)) ? str(o.due, 10) : '';
      if (!due) {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dueDays);
        due = d.toISOString().split('T')[0];
      }
      const paid = o.paid === true;
      const paidDate = DATE_RE.test(str(o.paidDate, 10)) ? str(o.paidDate, 10) : date;

      const { error } = await supabaseServer.from('invoices').insert({
        agent_id: agentId,
        transaction_id: transactionId,
        amount_owed: amount,
        invoice_number: relayNumber,
        invoice_date: `${date}T12:00:00Z`,
        due_date: due,
        paid,
        paid_at: paid ? `${paidDate}T12:00:00Z` : null,
        paid_amount: paid ? amount : null,
      });
      if (error) {
        console.error('QuickBooks import: insert failed', error);
        fail('Could not be saved');
        continue;
      }
      usedTx.add(transactionId);
      taken.add(relayNumber.toLowerCase());
      created.push(relayNumber);
    }

    await logAudit(request, user, 'quickbooks.import', { entityType: 'import', entityId: 'invoices', metadata: { created: created.length, skipped: skipped.length } });
    return NextResponse.json({ created: created.length, skipped });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt }, { status: error.status });
    }
    console.error('Error importing QuickBooks invoices:', error);
    return NextResponse.json({ error: 'Failed to import invoices' }, { status: 500 });
  }
}
