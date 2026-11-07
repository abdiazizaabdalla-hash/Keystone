import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { GET as listTransactions, POST as createTransaction } from '@/app/api/transactions/route';
import { POST as sendInvite } from '@/app/api/agent-invites/route';
import { POST as acceptInvite } from '@/app/api/agent-invites/accept/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { GET as listMessages } from '@/app/api/messages/route';
import { POST as createInvoice, PATCH as patchInvoice } from '@/app/api/invoices/route';
import { GET as invoicePdf } from '@/app/api/invoices/[id]/pdf/route';
import { POST as addDealContact } from '@/app/api/transactions/[id]/contacts/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Regression for the shared-deal flow: an agent invites a coordinator, the coordinator accepts (agent + deal contacts land in
// their own lists), the deal closes (the other side hears about it), and the coordinator invoices the agent and marks it paid.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor;
let agentWs: Actor;
let tc: Actor;
let outsider: Actor;
let dealId: string;
let invoiceId: string;

beforeAll(async () => {
  boss = await createActor('sb-admin', { is_admin: true });
  agentWs = await createCollaborator('sb-ws');
  tc = await createActor('sb-tc', { plan: 'pro' });
  outsider = await createActor('sb-out', { plan: 'pro' });
  const grant = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${agentWs.id}`, params: { id: agentWs.id }, body: { action: 'set_agent_workspace', enabled: true } });
  expect(grant.status).toBe(200);
  const a = await call(h(createAgent), agentWs, { method: 'POST', path: '/api/agents', body: { name: 'Seller Client', email: 'seller-client@example.test', flatFee: 0, percentFee: 0 } });
  const t = await call(h(createTransaction), agentWs, { method: 'POST', path: '/api/transactions', body: { agentId: (a.json as { id: string }).id, propertyAddress: '5 Billing Ct', purchasePrice: 500000, fileNumber: 'SB-1' } });
  expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
  dealId = ((t.json as { transaction?: { id: string }; id?: string }).transaction?.id ?? (t.json as { id: string }).id) as string;
});

afterAll(async () => {
  await cleanup();
});

describe('invite, accept and the coordinator’s own lists', () => {
  it('accepting gives the coordinator a pricing profile for the inviting agent, and the agent in Contacts', async () => {
    expect((await call(h(sendInvite), agentWs, { method: 'POST', path: '/api/agent-invites', body: { transactionId: dealId, email: tc.email, inviteeRole: 'tc' } })).status).toBe(200);
    const bell = await admin.from('notifications').select('id').eq('recipient_user_id', tc.id).eq('event_type', 'invite');
    expect(bell.data ?? []).toHaveLength(1);
    const res = await call(h(acceptInvite), tc, { method: 'POST', path: '/x', body: { transactionId: dealId } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const profile = (res.json as { agentProfile?: { id: string } | null }).agentProfile;
    expect(profile?.id).toBeTruthy();
    const { data: row } = await admin.from('agents').select('tc_user_id, email').eq('id', profile!.id).single();
    expect(row!.tc_user_id).toBe(tc.id);
    expect(row!.email).toBe(agentWs.email.toLowerCase());
    const { data: contacts } = await admin.from('contacts').select('email').eq('tc_user_id', tc.id).ilike('email', agentWs.email);
    expect(contacts ?? []).toHaveLength(1);
  });

  it('a person added to the deal afterwards also lands in the coordinator’s Contacts', async () => {
    const res = await call(h(addDealContact), agentWs, { method: 'POST', path: `/api/transactions/${dealId}/contacts`, params: { id: dealId }, body: { name: 'Lena Lender', email: 'lena-lender@example.test', role: 'Lender' } });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    const { data } = await admin.from('contacts').select('name').eq('tc_user_id', tc.id).ilike('email', 'lena-lender@example.test');
    expect(data ?? []).toHaveLength(1);
  });
});

describe('closing the deal tells the other side', () => {
  it('posts a closed line in the chat and a bell entry for the coordinator, once', async () => {
    const res = await call(h(patchTransaction), agentWs, { method: 'PATCH', path: `/api/transactions/x?id=${dealId}`, body: { status: 'Closed' } });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    const chat = await call(h(listMessages), tc, { method: 'GET', path: `/api/messages?transactionId=${dealId}` });
    expect((chat.json as Array<{ body: string }>).filter((m) => m.body.startsWith('✅ Deal closed by '))).toHaveLength(1);
    const { data: bell } = await admin.from('notifications').select('id').eq('recipient_user_id', tc.id).eq('transaction_id', dealId).eq('event_type', 'deal_closed');
    expect(bell ?? []).toHaveLength(1);
    // Saving the same status again announces nothing new.
    await call(h(patchTransaction), agentWs, { method: 'PATCH', path: `/api/transactions/x?id=${dealId}`, body: { status: 'Closed' } });
    const again = await call(h(listMessages), tc, { method: 'GET', path: `/api/messages?transactionId=${dealId}` });
    expect((again.json as Array<{ body: string }>).filter((m) => m.body.startsWith('✅ Deal closed by '))).toHaveLength(1);
  });
});

describe('the coordinator invoices the agent on the shared deal', () => {
  it('the deal in the coordinator’s list points at their own pricing profile', async () => {
    const list = await call(h(listTransactions), tc, { method: 'GET', path: '/api/transactions' });
    const row = (list.json as Array<{ id: string; shared?: boolean; tc_agent?: { id: string } | null }>).find((t) => t.id === dealId);
    expect(row?.shared).toBe(true);
    expect(row?.tc_agent?.id).toBeTruthy();
  });

  it('creates the invoice, refuses a second one, and nobody else can touch it', async () => {
    const made = await call(h(createInvoice), tc, { method: 'POST', path: '/api/invoices', body: { transactionId: dealId } });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    invoiceId = (made.json as { id: string }).id;
    expect((await call(h(createInvoice), tc, { method: 'POST', path: '/api/invoices', body: { transactionId: dealId } })).status).toBe(409);
    expect((await call(h(createInvoice), outsider, { method: 'POST', path: '/api/invoices', body: { transactionId: dealId } })).status).toBeGreaterThanOrEqual(400);
    expect((await call(h(patchInvoice), outsider, { method: 'PATCH', path: '/api/invoices', body: { invoiceId, paid: true } })).status).toBeGreaterThanOrEqual(400);
  });

  it('marks it paid and unpaid, and produces a PDF', async () => {
    const paid = await call(h(patchInvoice), tc, { method: 'PATCH', path: '/api/invoices', body: { invoiceId, paid: true } });
    expect(paid.status, JSON.stringify(paid.json)).toBeLessThan(300);
    expect((await admin.from('invoices').select('paid').eq('id', invoiceId).single()).data!.paid).toBe(true);
    const unpaid = await call(h(patchInvoice), tc, { method: 'PATCH', path: '/api/invoices', body: { invoiceId, paid: false } });
    expect(unpaid.status).toBeLessThan(300);
    const pdf = await invoicePdf(new NextRequest(`http://localhost/api/invoices/${invoiceId}/pdf`, { headers: { authorization: `Bearer ${tc.token}` } }), { params: Promise.resolve({ id: invoiceId }) });
    expect(pdf.status).toBe(200);
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
