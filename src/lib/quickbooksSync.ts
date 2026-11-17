import { after } from 'next/server';
import { supabaseServer } from './supabase';
import { agentLabels } from './oversight';
import { DEFAULT_BILL_ACCOUNT } from './quickbooks';
import { decryptSecret, encryptSecret } from './encryption';
import {
  QbApiError,
  QbAuthError,
  createInvoice,
  findArAccountId,
  createPayment,
  createBill,
  createBillPayment,
  ensureExpenseAccount,
  findBankAccountId,
  findBillByNumber,
  findOrCreateVendor,
  getBillBalance,
  ensureServiceItem,
  findInvoiceByNumber,
  findOrCreateCustomer,
  getInvoiceBalance,
  qbEnvironment,
  refreshQbTokens,
  type QbClient,
  type QbEnvironment,
} from './quickbooksApi';

// Keeps a TC's QuickBooks Online in step with their Relay invoices:
//   * an invoice created in Relay is created in QuickBooks (once; an invoice with that number that is already
//     there is linked instead of duplicated);
//   * when the invoice is paid in Relay (including a Stripe payment), a payment is recorded against it.
// Everything is best-effort and non-fatal: a QuickBooks problem is saved on the invoice ("Action needed") and
// never thrown into the request that triggered it. Relay never edits or deletes anything in QuickBooks.

interface Connection {
  tc_user_id: string;
  realm_id: string;
  company_name: string | null;
  environment: QbEnvironment;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  status: 'connected' | 'needs_reconnect';
  sync_invoices: boolean;
  sync_payments: boolean;
  item_id: string | null;
}

export async function getQbConnection(tcUserId: string): Promise<Connection | null> {
  const { data, error } = await supabaseServer.from('quickbooks_connections').select('*').eq('tc_user_id', tcUserId).maybeSingle();
  if (error || !data) return null; // table missing (SQL not run yet) behaves like "not connected"
  return data as Connection;
}

/** A usable access token, refreshing (and saving the rotated refresh token) when needed. Null when the connection is dead. */
async function clientFor(conn: Connection, forceRefresh = false): Promise<QbClient | null> {
  if (conn.status !== 'connected') return null;
  const stillGood = !forceRefresh && conn.access_token && conn.access_expires_at && new Date(conn.access_expires_at).getTime() - Date.now() > 2 * 60 * 1000;
  if (stillGood) {
    try {
      return { realmId: conn.realm_id, environment: conn.environment, accessToken: decryptSecret(conn.access_token as string) };
    } catch {
      /* fall through and refresh */
    }
  }
  try {
    const t = await refreshQbTokens(decryptSecret(conn.refresh_token));
    // Intuit rotates the refresh token on use: the new one must be saved, or the next refresh fails.
    await supabaseServer
      .from('quickbooks_connections')
      .update({
        refresh_token: encryptSecret(t.refresh_token),
        access_token: encryptSecret(t.access_token),
        access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('tc_user_id', conn.tc_user_id);
    return { realmId: conn.realm_id, environment: conn.environment, accessToken: t.access_token };
  } catch (e) {
    if (e instanceof QbAuthError && e.invalidGrant) {
      await supabaseServer.from('quickbooks_connections').update({ status: 'needs_reconnect', access_token: null, access_expires_at: null }).eq('tc_user_id', conn.tc_user_id);
    }
    console.error('QuickBooks token refresh failed (non-fatal):', e instanceof Error ? e.message : e);
    return null;
  }
}

interface InvoiceRow {
  id: string;
  agent_id: string;
  transaction_id: string | null;
  amount_owed: number;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_amount: number | null;
  qb_invoice_id: string | null;
  qb_payment_id: string | null;
  qb_sync_status: string | null;
}

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : new Date().toISOString().slice(0, 10));

async function mark(id: string, patch: { qb_invoice_id?: string | null; qb_payment_id?: string | null; qb_sync_status: 'synced' | 'error' | 'skipped'; qb_sync_error?: string | null }) {
  await supabaseServer
    .from('invoices')
    .update({ ...patch, qb_sync_error: patch.qb_sync_error ?? null, qb_synced_at: new Date().toISOString() })
    .eq('id', id);
}

export type SyncResult = { ok: boolean; status: 'synced' | 'error' | 'skipped' | 'not_connected'; message?: string };

// One sync per invoice at a time. Creating an invoice and marking it paid each start a sync; without this, two of them
// could both find the invoice missing in QuickBooks and both create it. The claim is a single atomic UPDATE, so only one
// caller gets it; a claim older than 90 seconds is treated as abandoned.
async function claimInvoice(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 90_000).toISOString();
  const { data } = await supabaseServer
    .from('invoices')
    .update({ qb_sync_status: 'syncing', qb_synced_at: new Date().toISOString() })
    .eq('id', id)
    .or(`qb_sync_status.is.null,qb_sync_status.neq.syncing,qb_synced_at.lt.${staleBefore}`)
    .select('id');
  return Boolean(data && data.length);
}

/** Sends one invoice (and, if it is paid, its payment) to QuickBooks. Safe to call again: it only does what is missing. */
export async function syncInvoiceToQuickBooks(invoiceId: string): Promise<SyncResult> {
  let claimed = false;
  for (let attempt = 0; attempt < 10 && !claimed; attempt++) {
    claimed = await claimInvoice(invoiceId);
    if (!claimed) await new Promise((r) => setTimeout(r, 2000)); // another sync is working on it: wait, then pick up what is left
  }
  if (!claimed) return { ok: false, status: 'error', message: 'Another sync of this invoice is still running. Try again in a minute.' };
  try {
    return await syncClaimedInvoice(invoiceId);
  } finally {
    // Paths that finish without recording a result leave the claim behind: release it.
    await supabaseServer.from('invoices').update({ qb_sync_status: null }).eq('id', invoiceId).eq('qb_sync_status', 'syncing');
  }
}

async function syncClaimedInvoice(invoiceId: string, forceRefresh = false): Promise<SyncResult> {
  try {
    const { data: inv } = await supabaseServer
      .from('invoices')
      .select('id, agent_id, transaction_id, amount_owed, invoice_number, invoice_date, due_date, paid, paid_at, paid_amount, qb_invoice_id, qb_payment_id, qb_sync_status')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!inv) return { ok: false, status: 'error', message: 'Invoice not found' };
    const invoice = inv as InvoiceRow;

    const { data: agent } = await supabaseServer.from('agents').select('id, name, email, brokerage, tc_user_id').eq('id', invoice.agent_id).maybeSingle();
    if (!agent?.tc_user_id) return { ok: false, status: 'not_connected' };
    const tcUserId = agent.tc_user_id as string;

    const conn = await getQbConnection(tcUserId);
    if (!conn) return { ok: false, status: 'not_connected' };
    const wantInvoices = conn.sync_invoices;
    const wantPayments = conn.sync_payments;
    if (!wantInvoices && !(wantPayments && invoice.qb_invoice_id)) return { ok: false, status: 'not_connected' };

    // Invoices that came from QuickBooks are already there.
    if (/^QB-/i.test(invoice.invoice_number)) {
      await mark(invoice.id, { qb_sync_status: 'skipped', qb_sync_error: 'Came from QuickBooks' });
      return { ok: true, status: 'skipped', message: 'Came from QuickBooks' };
    }
    if (!(Number(invoice.amount_owed) > 0)) {
      await mark(invoice.id, { qb_sync_status: 'skipped', qb_sync_error: 'A $0 invoice is not sent to QuickBooks' });
      return { ok: true, status: 'skipped', message: 'A $0 invoice is not sent to QuickBooks' };
    }

    const client = await clientFor(conn, forceRefresh);
    if (!client) {
      const msg = conn.status === 'needs_reconnect' ? 'QuickBooks needs to be reconnected in Settings' : 'Could not reach QuickBooks. It will be retried.';
      await mark(invoice.id, { qb_invoice_id: invoice.qb_invoice_id, qb_payment_id: invoice.qb_payment_id, qb_sync_status: 'error', qb_sync_error: msg });
      return { ok: false, status: 'error', message: msg };
    }

    try {
      // -- customer (one per agent, remembered) --
      const { data: map } = await supabaseServer.from('quickbooks_customers').select('qb_customer_id').eq('tc_user_id', tcUserId).eq('agent_id', agent.id).maybeSingle();
      let customerId = (map?.qb_customer_id as string | undefined) || '';
      const needCustomer = (wantInvoices && !invoice.qb_invoice_id) || (wantPayments && invoice.paid && !invoice.qb_payment_id);
      if (!customerId && needCustomer) {
        customerId = await findOrCreateCustomer(client, { name: agent.name as string, email: agent.email as string | null, company: agent.brokerage as string | null });
        await supabaseServer.from('quickbooks_customers').upsert({ tc_user_id: tcUserId, agent_id: agent.id, qb_customer_id: customerId }, { onConflict: 'tc_user_id,agent_id' });
      }

      // -- the invoice --
      let qbInvoiceId = invoice.qb_invoice_id;
      if (!qbInvoiceId && wantInvoices) {
        const existing = await findInvoiceByNumber(client, invoice.invoice_number);
        if (existing) {
          qbInvoiceId = existing.id; // already there (for example from a file import): link it, never duplicate it
        } else {
          let itemId = conn.item_id;
          if (!itemId) {
            itemId = await ensureServiceItem(client);
            await supabaseServer.from('quickbooks_connections').update({ item_id: itemId }).eq('tc_user_id', tcUserId);
          }
          let description = 'Transaction coordination fee';
          if (invoice.transaction_id) {
            const { data: tx } = await supabaseServer.from('transactions').select('property_address, file_number').eq('id', invoice.transaction_id).maybeSingle();
            if (tx) description = `Transaction coordination fee - ${tx.property_address} (${tx.file_number})`;
          }
          const arAccountId = await findArAccountId(client);
          qbInvoiceId = await createInvoice(client, {
            docNumber: invoice.invoice_number,
            customerId,
            itemId,
            amount: Number(invoice.amount_owed),
            date: day(invoice.invoice_date),
            dueDate: day(invoice.due_date),
            description,
            arAccountId,
          });
        }
      }

      // -- the payment --
      let qbPaymentId = invoice.qb_payment_id;
      if (qbInvoiceId && wantPayments && invoice.paid && !qbPaymentId) {
        const { balance } = await getInvoiceBalance(client, qbInvoiceId);
        if (balance <= 0.004) {
          qbPaymentId = 'already-paid'; // QuickBooks already shows it paid (someone recorded it there)
        } else {
          const gross = Number(invoice.paid_amount ?? invoice.amount_owed);
          qbPaymentId = await createPayment(client, {
            customerId,
            invoiceId: qbInvoiceId,
            amount: Math.min(gross, balance),
            date: day(invoice.paid_at),
            ref: invoice.invoice_number,
            note: 'Recorded by Relay TC when the invoice was marked paid',
          });
        }
      }

      await mark(invoice.id, { qb_invoice_id: qbInvoiceId, qb_payment_id: qbPaymentId, qb_sync_status: 'synced' });
      await supabaseServer.from('quickbooks_connections').update({ last_synced_at: new Date().toISOString() }).eq('tc_user_id', tcUserId);
      return { ok: true, status: 'synced' };
    } catch (e) {
      const tid = e instanceof QbApiError || e instanceof QbAuthError ? e.tid : undefined;
      const base =
        e instanceof QbApiError
          ? e.message
          : e instanceof QbAuthError
          ? 'QuickBooks needs to be reconnected in Settings'
          : 'Something went wrong talking to QuickBooks. It will be retried.';
      const message = tid ? `${base.slice(0, 230)} (QuickBooks ref ${tid})` : base;
      // The access token was refused (for example revoked early): get a fresh one and try once more. Only a refresh that
      // is itself refused (expired or revoked) turns into "reconnect".
      if (e instanceof QbAuthError && !forceRefresh) return syncClaimedInvoice(invoiceId, true);
      if (e instanceof QbAuthError) {
        await supabaseServer.from('quickbooks_connections').update({ status: 'needs_reconnect', access_token: null, access_expires_at: null }).eq('tc_user_id', tcUserId);
      }
      console.error(`QuickBooks sync failed for invoice ${invoice.id} (non-fatal):`, e instanceof Error ? e.message : e);
      await mark(invoice.id, { qb_invoice_id: invoice.qb_invoice_id, qb_payment_id: invoice.qb_payment_id, qb_sync_status: 'error', qb_sync_error: message.slice(0, 300) });
      return { ok: false, status: 'error', message };
    }
  } catch (error) {
    console.error('QuickBooks sync failed (non-fatal):', error);
    return { ok: false, status: 'error', message: 'Unexpected error' };
  }
}

/** Fire-and-forget for request handlers: runs after the response is sent, so QuickBooks never slows the user down. */
export function queueQuickBooksSync(invoiceId: string): void {
  try {
    after(async () => {
      await syncInvoiceToQuickBooks(invoiceId);
    });
  } catch {
    void syncInvoiceToQuickBooks(invoiceId);
  }
}

/** Invoices of this TC's agents that still need something done in QuickBooks. */
async function pendingInvoiceIds(tcUserId: string, includeErrors = false): Promise<string[]> {
  const { data: agents } = await supabaseServer.from('agents').select('id').eq('tc_user_id', tcUserId).limit(5000);
  const ids = (agents || []).map((a) => a.id as string);
  if (!ids.length) return [];
  const { data } = await supabaseServer
    .from('invoices')
    .select('id, invoice_number, amount_owed, paid, qb_invoice_id, qb_payment_id, qb_sync_status')
    .in('agent_id', ids)
    .order('invoice_date', { ascending: true })
    .limit(2000);
  return (data || [])
    .filter((i) => {
      if (/^QB-/i.test(String(i.invoice_number)) || !(Number(i.amount_owed) > 0)) return false;
      if (i.qb_sync_status === 'skipped') return false;
      if (i.qb_sync_status === 'error' && !includeErrors) return false; // retried only when the TC asks, so a bad invoice cannot loop forever
      if (!i.qb_invoice_id) return true;
      return Boolean(i.paid) && !i.qb_payment_id;
    })
    .map((i) => i.id as string);
}

export async function countQuickBooksWork(tcUserId: string): Promise<{ pending: number; needsAttention: number }> {
  const all = await pendingInvoiceIds(tcUserId, true);
  const fresh = await pendingInvoiceIds(tcUserId, false);
  const allC = await pendingCommissionIds(tcUserId, true);
  const freshC = await pendingCommissionIds(tcUserId, false);
  return { pending: fresh.length + freshC.length, needsAttention: all.length - fresh.length + (allC.length - freshC.length) };
}

/** Sends up to `limit` waiting invoices. The Settings button calls this repeatedly until nothing is left. */
export async function syncPendingForUser(tcUserId: string, limit = 12, includeErrors = false): Promise<{ processed: number; ok: number; failed: number; remaining: number }> {
  const ids = await pendingInvoiceIds(tcUserId, includeErrors);
  const commissionIds = await pendingCommissionIds(tcUserId, includeErrors);
  const work: { kind: 'invoice' | 'commission'; id: string }[] = [...ids.map((id) => ({ kind: 'invoice' as const, id })), ...commissionIds.map((id) => ({ kind: 'commission' as const, id }))];
  const batch = work.slice(0, limit);
  let ok = 0;
  let failed = 0;
  for (const w of batch) {
    const r = w.kind === 'invoice' ? await syncInvoiceToQuickBooks(w.id) : await syncCommissionToQuickBooks(w.id);
    if (r.ok) ok += 1;
    else failed += 1;
  }
  return { processed: batch.length, ok, failed, remaining: Math.max(0, work.length - batch.length) };
}

// ---------------------------------------------------------------------------------------------------------------
// Brokerage commissions. A commission statement the agent has agreed to is a payable, so it goes into QuickBooks as a
// bill from the agent (a vendor). When the brokerage marks it paid in Relay, a bill payment is recorded against it.
// Same rules as invoices: best-effort, never throws into the request, and Relay never edits or deletes in QuickBooks.
// ---------------------------------------------------------------------------------------------------------------

interface CommissionRow {
  id: string;
  transaction_id: string;
  owner_user_id: string;
  agent_user_id: string;
  statement_number: string;
  status: string;
  agent_net_cents: number;
  accepted_at: string | null;
  proposed_at: string | null;
  paid_on: string | null;
  qb_bill_id: string | null;
  qb_payment_id: string | null;
  qb_sync_status: string | null;
}

async function markCommission(id: string, patch: { qb_bill_id?: string | null; qb_payment_id?: string | null; qb_sync_status: 'synced' | 'error' | 'skipped' | null; qb_sync_error?: string | null }) {
  await supabaseServer.from('deal_commissions').update({ ...patch, qb_sync_error: patch.qb_sync_error ?? null, qb_synced_at: new Date().toISOString() }).eq('id', id);
}

async function claimCommission(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 90_000).toISOString();
  const { data } = await supabaseServer
    .from('deal_commissions')
    .update({ qb_sync_status: 'syncing', qb_synced_at: new Date().toISOString() })
    .eq('id', id)
    .or(`qb_sync_status.is.null,qb_sync_status.neq.syncing,qb_synced_at.lt.${staleBefore}`)
    .select('id');
  return Boolean(data && data.length);
}

/** Sends one commission (and, if it is paid, its payment) to QuickBooks. Safe to call again: it only does what is missing. */
export async function syncCommissionToQuickBooks(commissionId: string): Promise<SyncResult> {
  let claimed = false;
  for (let attempt = 0; attempt < 10 && !claimed; attempt++) {
    claimed = await claimCommission(commissionId);
    if (!claimed) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!claimed) return { ok: false, status: 'error', message: 'Another sync of this commission is still running. Try again in a minute.' };
  try {
    return await syncClaimedCommission(commissionId);
  } finally {
    await supabaseServer.from('deal_commissions').update({ qb_sync_status: null }).eq('id', commissionId).eq('qb_sync_status', 'syncing');
  }
}

async function syncClaimedCommission(commissionId: string, forceRefresh = false): Promise<SyncResult> {
  try {
    const { data } = await supabaseServer
      .from('deal_commissions')
      .select('id, transaction_id, owner_user_id, agent_user_id, statement_number, status, agent_net_cents, accepted_at, proposed_at, paid_on, qb_bill_id, qb_payment_id, qb_sync_status')
      .eq('id', commissionId)
      .maybeSingle();
    if (!data) return { ok: false, status: 'error', message: 'Commission not found' };
    const c = data as CommissionRow;
    const ownerId = c.owner_user_id;

    const conn = await getQbConnection(ownerId);
    if (!conn) return { ok: false, status: 'not_connected' };
    const wantBills = conn.sync_invoices;
    const wantPayments = conn.sync_payments;
    if (!wantBills && !(wantPayments && c.qb_bill_id)) return { ok: false, status: 'not_connected' };

    // Only amounts that are real: agreed (or paid) with something to pay. Estimates, proposals and voids are never sent.
    if (c.status !== 'accepted' && c.status !== 'paid') return { ok: true, status: 'skipped', message: 'Not agreed yet' };
    if (!(Number(c.agent_net_cents) > 0)) {
      await markCommission(c.id, { qb_sync_status: 'skipped', qb_sync_error: 'A $0 commission is not sent to QuickBooks' });
      return { ok: true, status: 'skipped', message: 'A $0 commission is not sent to QuickBooks' };
    }

    const client = await clientFor(conn, forceRefresh);
    if (!client) {
      const msg = conn.status === 'needs_reconnect' ? 'QuickBooks needs to be reconnected in Settings' : 'Could not reach QuickBooks. It will be retried.';
      await markCommission(c.id, { qb_bill_id: c.qb_bill_id, qb_payment_id: c.qb_payment_id, qb_sync_status: 'error', qb_sync_error: msg });
      return { ok: false, status: 'error', message: msg };
    }

    try {
      const amount = Number(c.agent_net_cents) / 100;
      const needVendor = (wantBills && !c.qb_bill_id) || (wantPayments && c.status === 'paid' && !c.qb_payment_id);
      let vendorId = '';
      if (needVendor) {
        const { data: map } = await supabaseServer.from('quickbooks_vendors').select('qb_vendor_id').eq('owner_user_id', ownerId).eq('agent_user_id', c.agent_user_id).maybeSingle();
        vendorId = (map?.qb_vendor_id as string | undefined) || '';
        if (!vendorId) {
          const label = (await agentLabels([c.agent_user_id])).get(c.agent_user_id);
          vendorId = await findOrCreateVendor(client, { name: label?.name ?? 'Agent', email: label?.email ?? null });
          await supabaseServer.from('quickbooks_vendors').upsert({ owner_user_id: ownerId, agent_user_id: c.agent_user_id, qb_vendor_id: vendorId }, { onConflict: 'owner_user_id,agent_user_id' });
        }
      }

      // -- the bill --
      let qbBillId = c.qb_bill_id;
      if (!qbBillId && wantBills) {
        const existing = await findBillByNumber(client, c.statement_number);
        if (existing) {
          qbBillId = existing.id; // already there (for example from a file import): link it, never duplicate it
        } else {
          const { data: tx } = await supabaseServer.from('transactions').select('property_address').eq('id', c.transaction_id).maybeSingle();
          const accountId = await ensureExpenseAccount(client, DEFAULT_BILL_ACCOUNT);
          const date = String(c.accepted_at || c.proposed_at || new Date().toISOString()).slice(0, 10);
          qbBillId = await createBill(client, {
            docNumber: c.statement_number,
            vendorId,
            accountId,
            amount,
            date,
            dueDate: date,
            description: `Commission${tx?.property_address ? ` - ${tx.property_address}` : ''} (${c.statement_number})`,
          });
        }
      }

      // -- the payment --
      let qbPaymentId = c.qb_payment_id;
      if (qbBillId && wantPayments && c.status === 'paid' && !qbPaymentId) {
        const { balance } = await getBillBalance(client, qbBillId);
        if (balance <= 0.004) {
          qbPaymentId = 'already-paid';
        } else {
          const bankAccountId = await findBankAccountId(client);
          qbPaymentId = await createBillPayment(client, {
            vendorId,
            billId: qbBillId,
            bankAccountId,
            amount: Math.min(amount, balance),
            date: String(c.paid_on || new Date().toISOString()).slice(0, 10),
            ref: c.statement_number,
            note: 'Recorded by Relay TC when the commission was marked paid',
          });
        }
      }

      await markCommission(c.id, { qb_bill_id: qbBillId, qb_payment_id: qbPaymentId, qb_sync_status: 'synced' });
      await supabaseServer.from('quickbooks_connections').update({ last_synced_at: new Date().toISOString() }).eq('tc_user_id', ownerId);
      return { ok: true, status: 'synced' };
    } catch (e) {
      const tid = e instanceof QbApiError || e instanceof QbAuthError ? e.tid : undefined;
      const base = e instanceof QbApiError ? e.message : e instanceof QbAuthError ? 'QuickBooks needs to be reconnected in Settings' : 'Something went wrong talking to QuickBooks. It will be retried.';
      const message = tid ? `${base.slice(0, 230)} (QuickBooks ref ${tid})` : base;
      if (e instanceof QbAuthError && !forceRefresh) return syncClaimedCommission(commissionId, true);
      if (e instanceof QbAuthError) {
        await supabaseServer.from('quickbooks_connections').update({ status: 'needs_reconnect', access_token: null, access_expires_at: null }).eq('tc_user_id', ownerId);
      }
      console.error(`QuickBooks sync failed for commission ${c.id} (non-fatal):`, e instanceof Error ? e.message : e);
      await markCommission(c.id, { qb_bill_id: c.qb_bill_id, qb_payment_id: c.qb_payment_id, qb_sync_status: 'error', qb_sync_error: message.slice(0, 300) });
      return { ok: false, status: 'error', message };
    }
  } catch (error) {
    console.error('QuickBooks commission sync failed (non-fatal):', error);
    return { ok: false, status: 'error', message: 'Unexpected error' };
  }
}

export function queueQuickBooksCommissionSync(commissionId: string): void {
  try {
    after(async () => {
      await syncCommissionToQuickBooks(commissionId);
    });
  } catch {
    void syncCommissionToQuickBooks(commissionId);
  }
}

/** Commissions of this brokerage that still need something done in QuickBooks. A missing column (SQL not run yet) behaves like "nothing to do". */
async function pendingCommissionIds(ownerId: string, includeErrors = false): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from('deal_commissions')
    .select('id, status, agent_net_cents, qb_bill_id, qb_payment_id, qb_sync_status')
    .eq('owner_user_id', ownerId)
    .in('status', ['accepted', 'paid'])
    .order('proposed_at', { ascending: true })
    .limit(2000);
  if (error || !data) return [];
  return data
    .filter((c) => {
      if (!(Number(c.agent_net_cents) > 0)) return false;
      if (c.qb_sync_status === 'skipped') return false;
      if (c.qb_sync_status === 'error' && !includeErrors) return false;
      if (!c.qb_bill_id) return true;
      return c.status === 'paid' && !c.qb_payment_id;
    })
    .map((c) => c.id as string);
}

/** Forget what was sent when a TC disconnects, so a later reconnect (maybe to another company) starts clean. */
export async function clearQuickBooksLinks(tcUserId: string): Promise<void> {
  await supabaseServer.from('quickbooks_customers').delete().eq('tc_user_id', tcUserId);
  await supabaseServer.from('quickbooks_vendors').delete().eq('owner_user_id', tcUserId);
  await supabaseServer.from('deal_commissions').update({ qb_bill_id: null, qb_payment_id: null, qb_sync_status: null, qb_sync_error: null, qb_synced_at: null }).eq('owner_user_id', tcUserId);
  const { data: agents } = await supabaseServer.from('agents').select('id').eq('tc_user_id', tcUserId).limit(5000);
  const ids = (agents || []).map((a) => a.id as string);
  if (ids.length) {
    await supabaseServer
      .from('invoices')
      .update({ qb_invoice_id: null, qb_payment_id: null, qb_sync_status: null, qb_sync_error: null, qb_synced_at: null })
      .in('agent_id', ids);
  }
}

export { qbEnvironment };
