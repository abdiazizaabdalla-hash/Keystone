import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { GET as listInvoices, POST as createInvoice } from '@/app/api/workspace-invoices/route';
import { GET as getInvoice, PATCH as patchInvoice, DELETE as deleteInvoice } from '@/app/api/workspace-invoices/[id]/route';
import { GET as invoicePdf } from '@/app/api/workspace-invoices/[id]/pdf/route';
import { POST as sendInvoice } from '@/app/api/workspace-invoices/[id]/send/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor } from './helpers';

// Phase 2b. Invoices for an agent with a workspace: from templates, billed to a contact, attached to a deal only
// when a coordinator is on it, and private to their owner.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor;
let ws: Actor;
let ws2: Actor;
let free: Actor;
let tc: Actor;
let ownDealId: string;
let tcDeal: Awaited<ReturnType<typeof seedDeal>>;
let contactId: string;
let foreignContactId: string;

const grant = async (who: Actor) => {
  const res = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${who.id}`, params: { id: who.id }, body: { action: 'set_agent_workspace', enabled: true } });
  expect(res.status).toBe(200);
};

beforeAll(async () => {
  boss = await createActor('v-admin', { is_admin: true });
  ws = await createCollaborator('v-ws');
  ws2 = await createCollaborator('v-ws2');
  free = await createCollaborator('v-free');
  tc = await createActor('v-tc', { plan: 'pro' });
  await grant(ws);
  await grant(ws2);
  const a = await call(h(createAgent), ws, { method: 'POST', path: '/api/agents', body: { name: 'Inv Agent', email: 'invagent@example.test', flatFee: 0, percentFee: 0 } });
  const t = await call(h(createTransaction), ws, { method: 'POST', path: '/api/transactions', body: { agentId: (a.json as { id: string }).id, propertyAddress: '1 Bill St', purchasePrice: 250000, fileNumber: 'INVC-1' } });
  expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
  ownDealId = ((t.json as { transaction?: { id: string }; id?: string }).transaction?.id ?? (t.json as { id: string }).id) as string;
  tcDeal = await seedDeal(tc, 'WSI');
  await addCollaboratorToDeal(tcDeal, ws, tc);
  const { data: c1 } = await admin.from('contacts').insert({ tc_user_id: ws.id, name: 'Casey Buyer', email: 'casey@example.test', company: 'Casey Co' }).select('id').single();
  const { data: c2 } = await admin.from('contacts').insert({ tc_user_id: ws2.id, name: 'Not Yours', email: 'notyours@example.test' }).select('id').single();
  contactId = c1!.id as string;
  foreignContactId = c2!.id as string;
});

afterAll(async () => {
  await admin.from('contacts').delete().in('id', [contactId, foreignContactId].filter(Boolean));
  await cleanup();
});

const create = (who: Actor, body: Record<string, unknown>) => call(h(createInvoice), who, { method: 'POST', path: '/api/workspace-invoices', body });
const idOf = (r: { json: unknown }) => (r.json as { id: string }).id;

describe('who has these invoices', () => {
  it('only an agent with a workspace', async () => {
    expect((await create(free, { templateKey: 'blank' })).status).toBe(403);
    expect((await create(tc, { templateKey: 'blank' })).status).toBe(403);
    expect((await call(h(listInvoices), free, { method: 'GET', path: '/api/workspace-invoices' })).status).toBe(403);
  });
});

describe('creating from a template', () => {
  it('fills in the title, lines, due date and number', async () => {
    const res = await create(ws, { templateKey: 'referral_fee' });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const inv = res.json as { invoice_number: string; title: string; lines: Array<{ description: string }>; due_date: string; status: string };
    expect(inv.invoice_number).toBe('INV-0001');
    expect(inv.title).toBe('Referral fee');
    expect(inv.lines).toHaveLength(1);
    expect(inv.due_date).toBeTruthy();
    expect(inv.status).toBe('draft');
    const second = await create(ws, { templateKey: 'blank' });
    expect((second.json as { invoice_number: string }).invoice_number).toBe('INV-0002');
  });

  it('bills to one of their own contacts, and refuses someone else’s', async () => {
    const ok = await create(ws, { templateKey: 'consulting', contactId });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const inv = ok.json as { bill_to_name: string; bill_to_email: string };
    expect(inv.bill_to_name).toContain('Casey');
    expect(inv.bill_to_email).toBe('casey@example.test');
    expect((await create(ws, { templateKey: 'blank', contactId: foreignContactId })).status).toBe(404);
  });
});

describe('attaching a deal', () => {
  it('is refused while the deal has no coordinator on it', async () => {
    const res = await create(ws, { templateKey: 'coordination_fee', transactionId: ownDealId });
    expect(res.status).toBe(400);
  });

  it('works once a coordinator is on the agent’s own deal, addressed to that coordinator', async () => {
    await addCollaboratorToDeal({ transactionId: ownDealId } as never, tc, ws);
    const res = await create(ws, { templateKey: 'coordination_fee', transactionId: ownDealId });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const inv = res.json as { bill_to_email: string; transaction_id: string; memo: string };
    expect(inv.bill_to_email).toBe(tc.email);
    expect(inv.transaction_id).toBe(ownDealId);
    expect(inv.memo).toContain('1 Bill St');
  });

  it('works on a deal the coordinator owns and added the agent to, but not on one they are not on', async () => {
    expect((await create(ws, { templateKey: 'admin_fee', transactionId: tcDeal.transactionId })).status).toBe(201);
    const stranger = await seedDeal(tc, 'WSX');
    expect([403, 404]).toContain((await create(ws, { templateKey: 'admin_fee', transactionId: stranger.transactionId })).status);
  });
});

describe('private to the owner, and editable until paid', () => {
  let invoiceId: string;
  beforeAll(async () => {
    invoiceId = idOf(await create(ws, { templateKey: 'marketing' }));
  });

  it('another agent cannot read, change, delete or download it', async () => {
    expect((await call(h(getInvoice), ws2, { method: 'GET', path: '/x', params: { id: invoiceId } })).status).toBe(404);
    expect((await call(h(patchInvoice), ws2, { method: 'PATCH', path: '/x', params: { id: invoiceId }, body: { title: 'hijack' } })).status).toBe(404);
    expect((await call(h(deleteInvoice), ws2, { method: 'DELETE', path: '/x', params: { id: invoiceId } })).status).toBe(404);
    expect((await call(h(invoicePdf), ws2, { method: 'GET', path: '/x', params: { id: invoiceId } })).status).toBe(404);
    const theirs = await call(h(listInvoices), ws2, { method: 'GET', path: '/api/workspace-invoices' });
    expect((theirs.json as Array<{ id: string }>).some((i) => i.id === invoiceId)).toBe(false);
  });

  it('edits lines and recalculates totals with tax', async () => {
    const res = await call(h(patchInvoice), ws, {
      method: 'PATCH',
      path: '/x',
      params: { id: invoiceId },
      body: { billToName: 'Lee Client', billToEmail: 'lee@example.test', taxPercent: 10, lines: [{ description: 'Photos', quantity: 2, unitPrice: 150 }, { description: 'Sign', quantity: 1, unitPrice: 50 }] },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const inv = res.json as { subtotal: number; tax: number; total: number; lines: unknown[] };
    expect(inv.lines).toHaveLength(2);
    expect([inv.subtotal, inv.tax, inv.total]).toEqual([350, 35, 385]);
  });

  it('builds a PDF', async () => {
    const res = await invoicePdf(
      new (await import('next/server')).NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${ws.token}` } }),
      { params: Promise.resolve({ id: invoiceId }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
  });

  it('will not send without an amount or an address', async () => {
    const blank = idOf(await create(ws, { templateKey: 'blank' }));
    expect((await call(h(sendInvoice), ws, { method: 'POST', path: '/x', params: { id: blank }, body: {} })).status).toBe(400);
  });

  it('marks paid, then refuses edits until reopened; a paid invoice cannot be voided or deleted', async () => {
    expect((await call(h(patchInvoice), ws, { method: 'PATCH', path: '/x', params: { id: invoiceId }, body: { action: 'mark_paid' } })).status).toBe(200);
    expect((await call(h(patchInvoice), ws, { method: 'PATCH', path: '/x', params: { id: invoiceId }, body: { title: 'late edit' } })).status).toBe(400);
    expect((await call(h(patchInvoice), ws, { method: 'PATCH', path: '/x', params: { id: invoiceId }, body: { action: 'void' } })).status).toBe(400);
    expect((await call(h(deleteInvoice), ws, { method: 'DELETE', path: '/x', params: { id: invoiceId } })).status).toBe(400);
    expect((await call(h(patchInvoice), ws, { method: 'PATCH', path: '/x', params: { id: invoiceId }, body: { action: 'reopen' } })).status).toBe(200);
  });

  it('deletes a never-sent draft', async () => {
    const draft = idOf(await create(ws, { templateKey: 'bonus' }));
    expect((await call(h(deleteInvoice), ws, { method: 'DELETE', path: '/x', params: { id: draft } })).status).toBe(200);
    expect((await call(h(getInvoice), ws, { method: 'GET', path: '/x', params: { id: draft } })).status).toBe(404);
  });
});
