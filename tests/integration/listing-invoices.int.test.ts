import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createAgent, PATCH as patchAgent } from '@/app/api/agents/route';
import { POST as createInvoice, GET as listInvoices } from '@/app/api/invoices/route';
import { POST as emailPayLink } from '@/app/api/invoices/[id]/email-pay-link/route';
import { GET as getListing } from '@/app/api/listings/[id]/route';
import { GET as invoicePdf } from '@/app/api/invoices/[id]/pdf/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// A coordinator can charge a listing fee, see and change the price before an invoice exists (a promotion), and email an agent a pay
// link. Listing invoices have no transaction.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const post = (who: Actor | null, body: Record<string, unknown>) => call(h(createInvoice), who, { method: 'POST', path: '/api/invoices', body });

let tc: Actor;
let other: Actor;
let agentId: string;
let deal: Deal;
let listingId: string;
let noAgentListing: string;
const invoiceIds: string[] = [];

beforeAll(async () => {
  tc = await createActor('li-tc', { plan: 'pro' });
  other = await createActor('li-other', { plan: 'pro' });
  const a = await call(h(createAgent), tc, { method: 'POST', path: '/api/agents', body: { name: 'Lister', email: 'lister@example.test', flatFee: 400, percentFee: 1, listingFee: 250 } });
  expect(a.status, JSON.stringify(a.json)).toBeLessThan(300);
  agentId = (a.json as { id: string }).id;
  const l = await admin.from('listings').insert({ tc_user_id: tc.id, agent_id: agentId, property_address: '7 Listing Way', list_price: 600000 }).select('id').single();
  listingId = l.data!.id;
  const l2 = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '8 Nobody Rd' }).select('id').single();
  noAgentListing = l2.data!.id;
  deal = await seedDeal(tc, 'LI');
  await admin.from('agents').update({ flat_fee: 400, commission_percent: 1 }).eq('id', deal.agentId);
  await admin.from('transactions').update({ purchase_price: 500000, status: 'Closed' }).eq('id', deal.transactionId);
}, 60_000);

afterAll(async () => {
  if (invoiceIds.length) await admin.from('invoices').delete().in('id', invoiceIds);
  await admin.from('listings').delete().in('id', [listingId, noAgentListing]);
  await cleanup();
});

describe('listing fee on the agent', () => {
  it('saves, changes and clears', async () => {
    const got = await admin.from('agents').select('listing_fee').eq('id', agentId).single();
    expect(Number(got.data!.listing_fee)).toBe(250);
    const up = await call(h(patchAgent), tc, { method: 'PATCH', path: '/api/agents', body: { id: agentId, name: 'Lister', listingFee: 300 } });
    expect(up.status, JSON.stringify(up.json)).toBeLessThan(300);
    expect(Number((await admin.from('agents').select('listing_fee').eq('id', agentId).single()).data!.listing_fee)).toBe(300);
    await call(h(patchAgent), tc, { method: 'PATCH', path: '/api/agents', body: { id: agentId, name: 'Lister', listingFee: null } });
    expect((await admin.from('agents').select('listing_fee').eq('id', agentId).single()).data!.listing_fee).toBeNull();
    await call(h(patchAgent), tc, { method: 'PATCH', path: '/api/agents', body: { id: agentId, name: 'Lister', listingFee: 250 } });
  });
});

describe('the confirm screen', () => {
  it('previews a deal invoice without creating anything', async () => {
    const res = await post(tc, { agentId: deal.agentId, transactionId: deal.transactionId, purchasePrice: 500000, preview: true });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ preview: true, kind: 'transaction', defaults: { flatFee: 400, percentFee: 5000 } });
    const rows = await admin.from('invoices').select('id').eq('transaction_id', deal.transactionId);
    expect(rows.data ?? []).toHaveLength(0);
  });
  it('previews a listing invoice with the agent’s listing fee', async () => {
    const res = await post(tc, { kind: 'listing', listingId, preview: true });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ kind: 'listing', defaults: { flatFee: 250 }, property: '7 Listing Way' });
  });
});

describe('creating with a changed price', () => {
  it('a deal invoice takes edited fees and a discount, and remembers them', async () => {
    const res = await post(tc, { agentId: deal.agentId, transactionId: deal.transactionId, purchasePrice: 500000, edits: { flatFee: 300, percentFee: 0, discount: 50, discountNote: 'Fall promo' } });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const inv = res.json as { id: string; amount_owed: number; adjustment: number; adjustment_note: string };
    invoiceIds.push(inv.id);
    expect(Number(inv.amount_owed)).toBe(250);
    expect(Number(inv.adjustment)).toBe(-50);
    expect(inv.adjustment_note).toBe('Fall promo');
    const pdf = await call(h(invoicePdf), tc, { method: 'GET', path: `/api/invoices/${inv.id}/pdf`, params: { id: inv.id } });
    expect(pdf.status).toBe(200);
  });
  it('a second invoice for the same deal is refused', async () => {
    const res = await post(tc, { agentId: deal.agentId, transactionId: deal.transactionId, purchasePrice: 500000 });
    expect(res.status).toBe(409);
  });
  it('rejects a discount bigger than the fees', async () => {
    const res = await post(tc, { kind: 'listing', listingId, edits: { flatFee: 100, discount: 500 } });
    expect(res.status).toBe(400);
  });
  it('a listing invoice uses the listing fee, has no transaction, and shows the listing', async () => {
    const res = await post(tc, { kind: 'listing', listingId });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const inv = res.json as { id: string; amount_owed: number; transaction_id: string | null; listing_id: string };
    invoiceIds.push(inv.id);
    expect(Number(inv.amount_owed)).toBe(250);
    expect(inv.transaction_id).toBeNull();
    expect(inv.listing_id).toBe(listingId);
    const list = await call(h(listInvoices), tc, { method: 'GET', path: '/api/invoices' });
    const row = (list.json as { id: string; transaction: { property_address: string; isListing?: boolean } | null }[]).find((r) => r.id === inv.id);
    expect(row?.transaction).toMatchObject({ property_address: '7 Listing Way', isListing: true });
    const pdf = await call(h(invoicePdf), tc, { method: 'GET', path: `/api/invoices/${inv.id}/pdf`, params: { id: inv.id } });
    expect(pdf.status).toBe(200);
    // The coordinator's listing page then shows this invoice in place of the "Generate invoice" prompt.
    const detail = await call(h(getListing), tc, { method: 'GET', path: `/api/listings/${listingId}`, params: { id: listingId } });
    expect((detail.json as { invoice: { id: string; paid: boolean } | null }).invoice).toMatchObject({ id: inv.id, paid: false });
  });
  it('the same listing cannot be billed twice to the same agent', async () => {
    const res = await post(tc, { kind: 'listing', listingId });
    expect(res.status).toBe(409);
    expect((res.json as { code?: string; error?: string }).error ?? '').toBeTruthy();
  });
  it('a listing with no agent is refused', async () => {
    const res = await post(tc, { kind: 'listing', listingId: noAgentListing });
    expect(res.status).toBe(400);
  });
  it('another coordinator cannot invoice my listing', async () => {
    const res = await post(other, { kind: 'listing', listingId: noAgentListing });
    expect([403, 404]).toContain(res.status);
  });
});

describe('emailing the pay link', () => {
  it('says Stripe is not connected when it is not', async () => {
    const id = invoiceIds[0];
    const res = await call(h(emailPayLink), tc, { method: 'POST', path: `/api/invoices/${id}/email-pay-link`, params: { id } });
    expect(res.status).toBe(400);
    expect((res.json as { code?: string }).code).toBe('stripe_not_connected');
  });
  it('is refused for someone else’s invoice', async () => {
    const id = invoiceIds[0];
    const res = await call(h(emailPayLink), other, { method: 'POST', path: `/api/invoices/${id}/email-pay-link`, params: { id } });
    expect([403, 404]).toContain(res.status);
  });
});

describe('other charges and the service list', () => {
  let svcListing: string;
  beforeAll(async () => {
    const l = await admin.from('listings').insert({ tc_user_id: tc.id, agent_id: agentId, property_address: '9 Services Ln', list_price: 400000 }).select('id').single();
    svcListing = l.data!.id;
  });
  afterAll(async () => {
    await admin.from('invoices').delete().eq('listing_id', svcListing);
    await admin.from('listings').delete().eq('id', svcListing);
  });

  it('saves the agent’s extra charges and drops bad rows', async () => {
    const up = await call(h(patchAgent), tc, {
      method: 'PATCH',
      path: '/api/agents',
      body: { id: agentId, name: 'Lister', listingFee: 250, services: [{ name: 'Rush file', amount: 75 }, { name: '', amount: 10 }, { name: 'Bad', amount: -5 }] },
    });
    expect(up.status, JSON.stringify(up.json)).toBeLessThan(300);
    const rows = (await admin.from('agents').select('services').eq('id', agentId).single()).data!.services as { name: string; amount: number }[];
    expect(rows.map((r) => r.name)).toEqual(['Rush file']);
    expect(rows[0].amount).toBe(75);
  });
  it('the confirm screen offers the standard fees and the saved charges', async () => {
    const res = await post(tc, { kind: 'listing', listingId: svcListing, preview: true });
    expect(res.status).toBe(200);
    const j = res.json as { defaults: { flatFee: number }; services: { name: string; amount: number }[]; otherFee: number | null };
    expect(j.defaults.flatFee).toBe(250);
    expect(j.otherFee).toBe(400);
    expect(j.services[0].name).toBe('Rush file');
  });
  it('bills a chosen service under its own name', async () => {
    const res = await post(tc, { kind: 'listing', listingId: svcListing, edits: { flatFee: 75, percentFee: 0, description: 'Rush file' } });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    const inv = res.json as { id: string; amount_owed: number; description: string };
    invoiceIds.push(inv.id);
    expect(Number(inv.amount_owed)).toBe(75);
    expect(inv.description).toBe('Rush file');
  });
});
