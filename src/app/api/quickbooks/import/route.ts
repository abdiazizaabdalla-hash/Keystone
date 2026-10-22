import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { logAudit } from '@/lib/audit';
import { normName, relayInvoiceNumber, textMentionsDeal } from '@/lib/quickbooks';
import { getPlanLimits } from '@/lib/plans';
import { autoAddContact } from '@/lib/contactsAuto';
import { getUserPlan } from '@/lib/privileged';
import crypto from 'crypto';

// Bring invoices from a QuickBooks export into Relay. The browser reads the file and sends clean rows; nothing is
// saved until the TC confirms.
//   mode "preview": match each row to one of THIS TC's agents and an unbilled deal, flag duplicates. Saves nothing.
//   mode "commit":  re-checks every choice on the server and creates the invoices. Existing invoices are never changed.
// An invoice in Relay always belongs to an agent and a deal (one invoice per deal). Nothing is skipped for lack of either:
// a customer that is not an agent yet is created as one (name only, the TC's default fees), and an invoice with no deal gets
// a small closed "Imported from QuickBooks" deal to hang on. Matches are never guessed: only an exact name/email or an
// address/file number in the memo links an invoice to something that already exists.

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
        return { ...r, relayNumber, status: 'ready' as const, agentId, transactionId };
      });
      const { maxAgents } = getPlanLimits(getUserPlan(user));
      return NextResponse.json({
        agentSlots: maxAgents === null ? null : Math.max(0, maxAgents - agentList.length),
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

    const meta = (tcUser?.user?.user_metadata || {}) as Record<string, unknown>;
    const defaultFlat = typeof meta.default_flat_fee === 'number' && meta.default_flat_fee >= 0 ? meta.default_flat_fee : 400;
    const defaultPercent = typeof meta.default_percent_fee === 'number' && meta.default_percent_fee >= 0 ? meta.default_percent_fee : 0;
    const { maxAgents } = getPlanLimits(getUserPlan(user));
    const feeByName = new Map<string, number>(); // normalized customer name -> flat fee chosen on the preview screen
    for (const a of Array.isArray(body.newAgents) ? body.newAgents : []) {
      const o = (a || {}) as Record<string, unknown>;
      const fee = Number(o.flatFee);
      if (str(o.name, 255) && Number.isFinite(fee) && fee >= 0 && fee <= 100000) feeByName.set(normName(str(o.name, 255)), Math.round(fee * 100) / 100);
    }
    const newAgents = new Map<string, string>(); // normalized customer name -> agent id created in this import
    const createdAgentIds: string[] = [];
    const createdDealIds: string[] = [];
    const createdInvoiceIds: string[] = [];
    let agentCount = agentList.length;
    let createdAgents = 0;
    let createdDeals = 0;

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
      let agentId = str(o.agentId, 64);
      let transactionId = str(o.transactionId, 64);
      const customer = str(o.customer, 255);
      if (taken.has(relayNumber.toLowerCase())) {
        fail('Already in Relay');
        continue;
      }

      // 1) The agent: one of this TC's own, or a new one made from the QuickBooks customer name.
      if (agentId) {
        if (!agentIds.has(agentId)) {
          fail('That agent is not yours');
          continue;
        }
      } else {
        const wanted = customer || 'Unknown customer';
        const key = normName(wanted);
        const existing = agentList.find((a) => normName(a.name as string) === key);
        if (existing) agentId = existing.id as string;
        else if (newAgents.has(key)) agentId = newAgents.get(key) as string;
        else {
          if (maxAgents !== null && agentCount >= maxAgents) {
            fail(`Your plan allows ${maxAgents} agent profile${maxAgents === 1 ? '' : 's'}; pick an existing agent for this one, or upgrade`);
            continue;
          }
          const agentRow = { tc_user_id: user.id, name: wanted, flat_fee: feeByName.get(key) ?? defaultFlat, commission_percent: defaultPercent };
          // Tagged "quickbooks" so these can be told apart (add-quickbooks-import-tags.sql); still works before that SQL has been run.
          let { data: agent, error: agentError } = await supabaseServer.from('agents').insert({ ...agentRow, source: 'quickbooks' }).select('id').single();
          if (agentError && /source/i.test(agentError.message || '')) {
            ({ data: agent, error: agentError } = await supabaseServer.from('agents').insert(agentRow).select('id').single());
          }
          if (agentError || !agent) {
            console.error('QuickBooks import: agent insert failed', agentError);
            fail('Could not create the agent');
            continue;
          }
          agentId = agent.id as string;
          newAgents.set(key, agentId);
          agentIds.add(agentId);
          agentCount += 1;
          createdAgents += 1;
          createdAgentIds.push(agentId);
          await autoAddContact(user.id, { name: wanted, role: 'Agent' });
          await logAudit(request, user, 'agent.create', { entityType: 'agent', entityId: agentId, metadata: { via: 'quickbooks.import' } });
        }
      }

      // 2) The deal: a chosen unbilled one, or a small closed placeholder so the invoice has something to belong to.
      let placeholderId: string | null = null;
      if (transactionId) {
        const tx = txById.get(transactionId);
        if (!tx || tx.agent_id !== agentId) {
          fail('That deal does not belong to that agent');
          continue;
        }
        if (billed.has(transactionId) || usedTx.has(transactionId)) {
          fail('That deal already has an invoice');
          continue;
        }
      } else {
        const memo = str(o.text, 500);
        let tx: { id: string } | null = null;
        for (let attempt = 0; attempt < 3 && !tx; attempt++) {
          const dealRow = {
            agent_id: agentId,
            tc_user_id: user.id,
            file_number: relayNumber,
            property_address: memo.slice(0, 300) || 'Imported from QuickBooks',
            status: 'Closed',
            purchase_price: 0,
            inbound_token: crypto.randomBytes(6).toString('hex'),
          };
          let { data, error } = await supabaseServer.from('transactions').insert({ ...dealRow, source: 'quickbooks' }).select('id').single();
          if (error && /source/i.test(error.message || '')) {
            ({ data, error } = await supabaseServer.from('transactions').insert(dealRow).select('id').single());
          }
          if (!error && data) tx = data as { id: string };
          else if (error?.code !== '23505') {
            console.error('QuickBooks import: deal insert failed', error);
            break;
          }
        }
        if (!tx) {
          fail('Could not be saved');
          continue;
        }
        transactionId = tx.id;
        placeholderId = tx.id;
        createdDeals += 1;
        createdDealIds.push(tx.id);
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

      const { data: inserted, error } = await supabaseServer.from('invoices').insert({
        agent_id: agentId,
        transaction_id: transactionId,
        amount_owed: amount,
        invoice_number: relayNumber,
        invoice_date: `${date}T12:00:00Z`,
        due_date: due,
        paid,
        paid_at: paid ? `${paidDate}T12:00:00Z` : null,
        paid_amount: paid ? amount : null,
      }).select('id').single();
      if (error) {
        console.error('QuickBooks import: insert failed', error);
        if (placeholderId) {
          await supabaseServer.from('transactions').delete().eq('id', placeholderId);
          createdDeals -= 1;
          createdDealIds.pop();
        }
        fail('Could not be saved');
        continue;
      }
      usedTx.add(transactionId);
      taken.add(relayNumber.toLowerCase());
      created.push(relayNumber);
      if (inserted?.id) createdInvoiceIds.push(inserted.id as string);
    }

    await logAudit(request, user, 'quickbooks.import', { entityType: 'import', entityId: 'invoices', metadata: { created: created.length, skipped: skipped.length, agents: createdAgents, deals: createdDeals } });
    return NextResponse.json({ created: created.length, skipped, createdAgents, createdDeals, createdInvoiceIds, createdDealIds, createdAgentIds });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt }, { status: error.status });
    }
    console.error('Error importing QuickBooks invoices:', error);
    return NextResponse.json({ error: 'Failed to import invoices' }, { status: 500 });
  }
}

// Undo an import. The browser sends back the ids the import returned; every one is re-checked here. Only invoices that
// belong to this TC's agents (and were not already sent to QuickBooks) are removed, then the placeholder deals and agents
// that import created, but only if nothing else has been added to them since.
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    const body = await request.json().catch(() => ({}));
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 600) : []);
    const invoiceIds = ids(body.invoiceIds);
    const dealIds = ids(body.dealIds);
    const agentIds = ids(body.agentIds);
    if (invoiceIds.length === 0) return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });

    const { data: mine } = await supabaseServer.from('agents').select('id').eq('tc_user_id', user.id).limit(5000);
    const myAgents = new Set((mine || []).map((a) => a.id as string));

    let removedInvoices = 0;
    const kept: string[] = [];
    for (let i = 0; i < invoiceIds.length; i += 100) {
      const { data: rows } = await supabaseServer
        .from('invoices')
        .select('id, agent_id, invoice_number, qb_invoice_id')
        .in('id', invoiceIds.slice(i, i + 100));
      const deletable: string[] = [];
      for (const r of rows || []) {
        if (!myAgents.has(r.agent_id as string)) continue;
        if (r.qb_invoice_id) {
          kept.push(String(r.invoice_number));
          continue;
        }
        deletable.push(r.id as string);
      }
      if (deletable.length) {
        const { error } = await supabaseServer.from('invoices').delete().in('id', deletable);
        if (error) throw error;
        removedInvoices += deletable.length;
      }
    }

    let removedDeals = 0;
    for (const id of dealIds) {
      const { data: tx } = await supabaseServer.from('transactions').select('id, agent_id, status').eq('id', id).maybeSingle();
      if (!tx || !myAgents.has(tx.agent_id as string) || tx.status !== 'Closed') continue;
      const { count: invCount } = await supabaseServer.from('invoices').select('id', { count: 'exact', head: true }).eq('transaction_id', id);
      const { count: taskCount } = await supabaseServer.from('tasks').select('id', { count: 'exact', head: true }).eq('transaction_id', id);
      if ((invCount || 0) > 0 || (taskCount || 0) > 0) continue;
      const { error } = await supabaseServer.from('transactions').delete().eq('id', id);
      if (!error) removedDeals += 1;
    }

    let removedAgents = 0;
    for (const id of agentIds) {
      if (!myAgents.has(id)) continue;
      const { count: txCount } = await supabaseServer.from('transactions').select('id', { count: 'exact', head: true }).eq('agent_id', id);
      const { count: invCount } = await supabaseServer.from('invoices').select('id', { count: 'exact', head: true }).eq('agent_id', id);
      if ((txCount || 0) > 0 || (invCount || 0) > 0) continue;
      const { error } = await supabaseServer.from('agents').delete().eq('id', id).eq('tc_user_id', user.id);
      if (!error) removedAgents += 1;
    }

    await logAudit(request, user, 'quickbooks.import.undo', { entityType: 'import', entityId: 'invoices', metadata: { invoices: removedInvoices, deals: removedDeals, agents: removedAgents } });
    return NextResponse.json({ removedInvoices, removedDeals, removedAgents, kept });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt }, { status: error.status });
    }
    console.error('Error undoing QuickBooks import:', error);
    return NextResponse.json({ error: 'Failed to undo the import' }, { status: 500 });
  }
}
