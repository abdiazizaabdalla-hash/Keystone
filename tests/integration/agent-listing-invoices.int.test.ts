import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createInvoice } from '@/app/api/invoices/route';
import { GET as agentInvoices } from '@/app/api/agent/invoices/route';
import { GET as invoicePdf } from '@/app/api/invoices/[id]/pdf/route';
import { admin, call, cleanup, createActor, type Actor } from './helpers';

// A listing fee a coordinator invoices shows up for the agent it is billed to, the same way a transaction coordination fee does:
// in their Invoices list, on the listing, and downloadable. Nobody else sees it.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let agent: Actor;
let stranger: Actor;
let listingId: string;
let invoiceId: string;

beforeAll(async () => {
  tc = await createActor('ali-tc', { plan: 'pro' });
  agent = await createActor('ali-agent', { role: 'agent', account_type: 'agent' });
  stranger = await createActor('ali-stranger', { role: 'agent', account_type: 'agent' });
  const a = await call(h(createAgent), tc, { method: 'POST', path: '/api/agents', body: { name: 'Billed Agent', email: agent.email, flatFee: 400, percentFee: 0, listingFee: 250 } });
  expect(a.status, JSON.stringify(a.json)).toBeLessThan(300);
  const agentRow = (a.json as { id: string }).id;
  const l = await admin.from('listings').insert({ tc_user_id: tc.id, agent_id: agentRow, property_address: '9 Fee Lane', list_price: 500000, share_with_agent: true }).select('id').single();
  listingId = l.data!.id;
  const inv = await call(h(createInvoice), tc, { method: 'POST', path: '/api/invoices', body: { kind: 'listing', listingId } });
  expect(inv.status, JSON.stringify(inv.json)).toBeLessThan(300);
  invoiceId = ((inv.json as { id?: string; invoice?: { id: string } }).id || (inv.json as { invoice: { id: string } }).invoice.id) as string;
}, 60_000);

afterAll(async () => {
  if (invoiceId) await admin.from('invoices').delete().eq('id', invoiceId);
  await admin.from('listings').delete().eq('id', listingId);
  await cleanup();
});

describe('listing fee on the agent side', () => {
  it('shows in the agent invoice list with the listing', async () => {
    const res = await call(h(agentInvoices), agent, { method: 'GET', path: '/api/agent/invoices' });
    expect(res.status).toBe(200);
    const row = (res.json as { id: string; listing: { id: string; propertyAddress: string } | null; transaction: unknown }[]).find((i) => i.id === invoiceId);
    expect(row).toBeTruthy();
    expect(row!.listing?.id).toBe(listingId);
    expect(row!.listing?.propertyAddress).toBe('9 Fee Lane');
    expect(row!.transaction).toBeNull();
  });

  it('is found by listing, and the agent can download the PDF', async () => {
    const res = await call(h(agentInvoices), agent, { method: 'GET', path: `/api/agent/invoices?listingId=${listingId}` });
    expect((res.json as { id: string }[]).map((i) => i.id)).toEqual([invoiceId]);
    const pdf = await call(h(invoicePdf), agent, { method: 'GET', path: `/api/invoices/${invoiceId}/pdf`, params: { id: invoiceId } });
    expect(pdf.status).toBe(200);
  });

  it('is invisible to another agent', async () => {
    const res = await call(h(agentInvoices), stranger, { method: 'GET', path: '/api/agent/invoices' });
    expect((res.json as { id: string }[]).some((i) => i.id === invoiceId)).toBe(false);
    const pdf = await call(h(invoicePdf), stranger, { method: 'GET', path: `/api/invoices/${invoiceId}/pdf`, params: { id: invoiceId } });
    expect(pdf.status).toBe(403);
  });
});
