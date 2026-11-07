import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { POST as sendInvite } from '@/app/api/agent-invites/route';
import { POST as acceptInvite } from '@/app/api/agent-invites/accept/route';
import { GET as listWs, POST as createWs } from '@/app/api/workspace-invoices/route';
import { GET as receivedWs } from '@/app/api/workspace-invoices/received/route';
import { GET as wsPdf } from '@/app/api/workspace-invoices/[id]/pdf/route';
import { POST as wsPayLink } from '@/app/api/workspace-invoices/[id]/pay-link/route';
import { GET as qbExport } from '@/app/api/agent-quickbooks/export/route';
import { DELETE as qbUndo, POST as qbImport } from '@/app/api/agent-quickbooks/import/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Paying works both ways through Stripe: a coordinator's invoice goes into the coordinator's connected account, and an agent's
// invoice goes into the agent's. Stripe is replaced with a fake that accepts any signed event; the database is relay-test.

vi.mock('@/lib/stripeConnect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripeConnect')>()),
  constructConnectWebhookEvent: (raw: string, signature: string) => {
    if (signature !== 'valid-signature') throw new Error('bad signature');
    return JSON.parse(raw);
  },
}));
const { POST: connectWebhook } = await import('@/app/api/stripe/connect/webhook/route');

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor;
let agentWs: Actor;
let tc: Actor;
let outsider: Actor;
let dealId: string;
let invoiceId: string;
const ACCOUNT = `acct_test_${Math.random().toString(36).slice(2, 10)}`;

async function webhook(event: object, signature = 'valid-signature') {
  return connectWebhook(
    new NextRequest('http://localhost/api/stripe/connect/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, ...event }),
    })
  );
}
const paidEvent = (id: string, cents: number, account = ACCOUNT) => ({
  type: 'checkout.session.completed',
  account,
  data: { object: { object: 'checkout.session', payment_status: 'paid', amount_total: cents, metadata: { relay_workspace_invoice_id: id } } },
});

beforeAll(async () => {
  boss = await createActor('wp-admin', { is_admin: true });
  agentWs = await createCollaborator('wp-ws');
  tc = await createActor('wp-tc', { plan: 'pro' });
  outsider = await createActor('wp-out', { plan: 'pro' });
  await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${agentWs.id}`, params: { id: agentWs.id }, body: { action: 'set_agent_workspace', enabled: true } });
  const a = await call(h(createAgent), agentWs, { method: 'POST', path: '/api/agents', body: { name: 'Client', email: 'wp-client@example.test', flatFee: 0, percentFee: 0 } });
  const t = await call(h(createTransaction), agentWs, { method: 'POST', path: '/api/transactions', body: { agentId: (a.json as { id: string }).id, propertyAddress: '8 Referral Rd', purchasePrice: 300000, fileNumber: 'WP-1' } });
  dealId = ((t.json as { transaction?: { id: string }; id?: string }).transaction?.id ?? (t.json as { id: string }).id) as string;
  await call(h(sendInvite), agentWs, { method: 'POST', path: '/api/agent-invites', body: { transactionId: dealId, email: tc.email, inviteeRole: 'tc' } });
  expect((await call(h(acceptInvite), tc, { method: 'POST', path: '/x', body: { transactionId: dealId } })).status).toBe(200);
});

afterAll(async () => {
  await admin.from('payment_accounts').delete().eq('connected_account_id', ACCOUNT);
  await cleanup();
});

describe('an agent invoices their coordinator', () => {
  it('creates an invoice on the deal; it is the agent’s until sent, then the coordinator sees it', async () => {
    const made = await call(h(createWs), agentWs, {
      method: 'POST',
      path: '/api/workspace-invoices',
      body: { transactionId: dealId, title: 'Referral fee', lines: [{ description: 'Referral fee', quantity: 1, unitPrice: 250 }] },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    invoiceId = (made.json as { id: string }).id;
    // A draft is private to the sender.
    expect(((await call(h(receivedWs), tc, { method: 'GET', path: '/api/workspace-invoices/received' })).json as unknown[]).length).toBe(0);
    expect((await call(h(wsPdf), tc, { method: 'GET', path: '/x', params: { id: invoiceId } })).status).toBe(404);
    await admin.from('workspace_invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', invoiceId);
    const list = (await call(h(receivedWs), tc, { method: 'GET', path: '/api/workspace-invoices/received' })).json as Array<{ id: string; total: number; payOnline: boolean; fromName: string }>;
    expect(list.map((i) => i.id)).toEqual([invoiceId]);
    expect(list[0].total).toBe(250);
    expect(list[0].payOnline).toBe(false);
    expect((await call(h(wsPdf), tc, { method: 'GET', path: '/x', params: { id: invoiceId } })).status).toBe(200);
  });

  it('nobody else can see, download or pay it', async () => {
    expect(((await call(h(receivedWs), outsider, { method: 'GET', path: '/api/workspace-invoices/received' })).json as unknown[]).length).toBe(0);
    expect((await call(h(wsPdf), outsider, { method: 'GET', path: '/x', params: { id: invoiceId } })).status).toBe(404);
    expect((await call(h(wsPayLink), outsider, { method: 'POST', path: '/x', params: { id: invoiceId } })).status).toBe(404);
  });

  it('cannot be paid online until the agent has connected Stripe', async () => {
    const res = await call(h(wsPayLink), tc, { method: 'POST', path: '/x', params: { id: invoiceId } });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/not connected Stripe/);
  });
});

describe('payment arrives from Stripe', () => {
  it('connecting the agent’s Stripe makes it payable online for the coordinator', async () => {
    await admin.from('payment_accounts').insert({ tc_user_id: agentWs.id, provider: 'stripe_connect', connected_account_id: ACCOUNT, status: 'approved' });
    const list = (await call(h(receivedWs), tc, { method: 'GET', path: '/api/workspace-invoices/received' })).json as Array<{ payOnline: boolean }>;
    expect(list[0].payOnline).toBe(true);
  });

  it('ignores a bad signature, another account’s event, and a payment that is too small', async () => {
    expect((await webhook(paidEvent(invoiceId, 25000), 'nope')).status).toBe(400);
    await webhook(paidEvent(invoiceId, 25000, 'acct_someone_else'));
    await webhook(paidEvent(invoiceId, 100));
    expect((await admin.from('workspace_invoices').select('status').eq('id', invoiceId).single()).data!.status).toBe('sent');
  });

  it('a payment that covers it marks it paid once, tells the agent, and shows paid to both', async () => {
    expect((await webhook(paidEvent(invoiceId, 25000))).status).toBe(200);
    expect((await webhook(paidEvent(invoiceId, 25000))).status).toBe(200); // delivered twice
    const { data } = await admin.from('workspace_invoices').select('status, paid_at').eq('id', invoiceId).single();
    expect(data!.status).toBe('paid');
    expect(data!.paid_at).toBeTruthy();
    const { data: bell } = await admin.from('notifications').select('title').eq('recipient_user_id', agentWs.id).eq('event_type', 'invoice');
    expect((bell ?? []).filter((b) => /was paid/.test(b.title as string))).toHaveLength(1);
    const seen = (await call(h(receivedWs), tc, { method: 'GET', path: '/api/workspace-invoices/received' })).json as Array<{ status: string }>;
    expect(seen[0].status).toBe('paid');
    expect((await call(h(wsPayLink), tc, { method: 'POST', path: '/x', params: { id: invoiceId } })).status).toBe(400);
  });
});

describe('QuickBooks files for an agent', () => {
  it('exports their invoices in QuickBooks’ layout, and only theirs', async () => {
    const res = await qbExport(new NextRequest('http://localhost/api/agent-quickbooks/export?type=invoices&status=all', { headers: { authorization: `Bearer ${agentWs.token}` } }));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split('\n')[0]).toContain('InvoiceNo');
    expect(csv).toContain('Referral fee');
    const count = await call(h(qbExport), agentWs, { method: 'GET', path: '/api/agent-quickbooks/export?type=count&status=all' });
    expect((count.json as { count: number }).count).toBe(1);
    const free = await createCollaborator('wp-free');
    expect((await call(h(qbExport), free, { method: 'GET', path: '/api/agent-quickbooks/export?type=count' })).status).toBe(403);
  });

  it('imports a QuickBooks list: flags what is already there, adds the rest, and can undo it', async () => {
    const rows = [
      { row: 1, number: '1001', customer: 'Pat Buyer', amount: 500, date: '2026-10-01', due: '2026-10-31', balance: 500, text: 'Consulting', paid_date: '' },
      { row: 2, number: '1002', customer: 'Sam Seller', amount: 750, date: '2026-10-02', due: '', balance: 0, text: '', paid_date: '2026-10-09' },
    ];
    const preview = await call(h(qbImport), agentWs, { method: 'POST', path: '/x', body: { mode: 'preview', rows } });
    expect((preview.json as { rows: Array<{ status: string }> }).rows.map((r) => r.status)).toEqual(['ready', 'ready']);
    const commit = await call(h(qbImport), agentWs, { method: 'POST', path: '/x', body: { mode: 'commit', rows } });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    const made = commit.json as { created: number; createdInvoiceIds: string[] };
    expect(made.created).toBe(2);
    const mine = (await call(h(listWs), agentWs, { method: 'GET', path: '/api/workspace-invoices' })).json as Array<{ invoice_number: string; status: string; total: number }>;
    expect(mine.find((i) => i.invoice_number === 'QB-1001')).toMatchObject({ status: 'sent', total: 500 });
    expect(mine.find((i) => i.invoice_number === 'QB-1002')).toMatchObject({ status: 'paid', total: 750 });
    const again = await call(h(qbImport), agentWs, { method: 'POST', path: '/x', body: { mode: 'preview', rows } });
    expect((again.json as { rows: Array<{ status: string }> }).rows.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    // Someone else cannot undo their import, but they can.
    expect(((await call(h(qbUndo), outsider, { method: 'DELETE', path: '/x', body: { invoiceIds: made.createdInvoiceIds } })).status)).toBe(403);
    const undone = await call(h(qbUndo), agentWs, { method: 'DELETE', path: '/x', body: { invoiceIds: made.createdInvoiceIds } });
    expect((undone.json as { removed: number }).removed).toBe(2);
  });
});
