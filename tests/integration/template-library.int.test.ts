import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/templates/route';
import { DELETE as deleteTemplate, PATCH as patchTemplate } from '@/app/api/templates/[id]/route';
import { POST as uploadPdf } from '@/app/api/templates/library/route';
import { POST as addToDeal } from '@/app/api/templates/add-to-deal/route';
import { POST as addToListing } from '@/app/api/templates/add-to-listing/route';
import { DELETE as deleteLink, GET as listLinks, POST as createLink } from '@/app/api/templates/state-links/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// The template library: PDFs are uploaded with a classification (state-specific, brokerage-wide, or general), organized by state and
// document category, and copied into deals and listings as the deal's own file. State resources are links only.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 37, 69, 79, 70]);

let broker: Actor;
let agent: Actor; // joined the brokerage
let outsider: Actor;
let deal: Deal;
let listingId = '';

const upload = (who: Actor, fields: Record<string, string>, file: File | null = new File([PDF], 'contract.pdf', { type: 'application/pdf' })) => {
  const fd = new FormData();
  if (file) fd.append('file', file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return uploadPdf(new NextRequest('http://localhost/api/templates/library', { method: 'POST', headers: { authorization: `Bearer ${who.token}` }, body: fd }));
};
const list = async (who: Actor, qs = '') => (await call(h(listTemplates), who, { method: 'GET', path: `/api/templates${qs}` })).json as { id: string; name: string; states: string[]; document_category: string; from_brokerage?: boolean }[];
const body = async (res: Response) => (await res.json()) as Record<string, unknown> & { id?: string; error?: string };

beforeAll(async () => {
  broker = await createActor('tl-broker', { plan: 'team' });
  agent = await createActor('tl-agent', { role: 'agent', agent_workspace: true });
  outsider = await createActor('tl-out', { role: 'agent', agent_workspace: true });
  deal = await seedDeal(agent, 'TL');
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', responded_at: new Date().toISOString() });
  const { data } = await admin.from('listings').insert({ tc_user_id: agent.id, property_address: '9 Elm St, Austin, TX 78701' }).select('id').single();
  listingId = data!.id as string;
}, 60_000);
afterAll(async () => {
  await admin.from('listings').delete().eq('id', listingId);
  await cleanup();
});

describe('uploading a PDF with its classification', () => {
  it('a state-specific PDF needs a state and a category, and lands in that state folder', async () => {
    expect((await upload(agent, { scope: 'state', documentCategory: 'contract_disclosures' })).status).toBe(400); // no state
    expect((await upload(agent, { scope: 'state', state: 'TX' })).status).toBe(400); // no category
    expect((await upload(agent, { name: 'x', scope: 'maybe', state: 'TX', documentCategory: 'closing' })).status).toBe(400);
    const res = await upload(agent, { scope: 'state', state: 'TX', documentCategory: 'contract_disclosures', documentType: 'Purchase Contract', name: 'TX resale contract' });
    expect(res.status).toBe(201);
    const row = await body(res);
    expect(row).toMatchObject({ name: 'TX resale contract', kind: 'form', states: ['TX'], document_category: 'contract_disclosures', document_type: 'Purchase Contract', brokerage_shared: false });
    expect((await list(agent, '?kinds=form&state=TX')).map((t) => t.name)).toContain('TX resale contract');
    expect((await list(agent, '?kinds=form&state=CA')).map((t) => t.name)).not.toContain('TX resale contract');
  });

  it('only accepts real PDFs, and says so', async () => {
    const notPdf = await upload(agent, { scope: 'general', documentCategory: 'other' }, new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'notes.pdf', { type: 'application/pdf' }));
    expect(notPdf.status).toBe(400);
    expect((await body(notPdf)).error).toMatch(/PDF/);
    expect((await upload(agent, { scope: 'general', documentCategory: 'other' }, null)).status).toBe(400);
  });

  it('a general PDF is for every state, and the name defaults to the file name', async () => {
    const row = await body(await upload(agent, { scope: 'general', documentCategory: 'other' }, new File([PDF], 'Wire fraud notice.pdf', { type: 'application/pdf' })));
    expect(row).toMatchObject({ name: 'Wire fraud notice', states: [], document_category: 'other' });
  });

  it('a brokerage template is for brokerage owners only and is shared with their agents', async () => {
    expect((await upload(agent, { scope: 'brokerage', name: 'Agent tries' })).status).toBe(403);
    expect((await upload(agent, { scope: 'general', documentCategory: 'other', share: 'true' })).status).toBe(403);
    const res = await upload(broker, { scope: 'brokerage', name: 'Brokerage IABS', documentCategory: 'contract_disclosures', documentType: 'IABS / Agency Documents' });
    expect(res.status).toBe(201);
    const row = await body(res);
    expect(row).toMatchObject({ brokerage_shared: true, states: [] });
    const mine = await list(agent, '?kinds=form');
    expect(mine.find((t) => t.id === row.id)?.from_brokerage).toBe(true);
    expect((await list(outsider, '?kinds=form')).some((t) => t.id === row.id)).toBe(false);
  });
});

describe('adding library PDFs to a deal', () => {
  const add = (who: Actor, ids: string[]) => call(h(addToDeal), who, { method: 'POST', path: '/api/templates/add-to-deal', body: { transactionId: deal.transactionId, templateIds: ids } });
  let txId = '';
  let brokerageId = '';

  it('files each PDF under its own category and type, as a separate copy', async () => {
    txId = (await list(agent, '?kinds=form&state=TX')).find((t) => t.name === 'TX resale contract')!.id;
    brokerageId = (await list(agent, '?kinds=form')).find((t) => t.name === 'Brokerage IABS')!.id;
    const res = await add(agent, [txId, brokerageId]);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect((res.json as { added: unknown[] }).added).toHaveLength(2);
    const { data } = await admin.from('documents').select('file_name, category, document_type, storage_path').eq('transaction_id', deal.transactionId).in('file_name', ['contract.pdf']);
    expect(data).toHaveLength(2);
    expect(data!.map((d) => `${d.category}/${d.document_type}`).sort()).toEqual(['contract_disclosures/IABS / Agency Documents', 'contract_disclosures/Purchase Contract']);
    const template = (await admin.from('doc_templates').select('storage_path').eq('id', txId).single()).data!;
    expect(data!.every((d) => d.storage_path !== template.storage_path)).toBe(true);
  });

  it('someone outside the brokerage cannot attach the brokerage template or another person’s PDF', async () => {
    const res = await call(h(addToDeal), outsider, { method: 'POST', path: '/api/templates/add-to-deal', body: { transactionId: deal.transactionId, templateIds: [txId] } });
    expect(res.status).toBeGreaterThanOrEqual(403);
  });

  it('deleting the template leaves the deal’s copy in place, and members cannot delete the brokerage one', async () => {
    expect((await call(h(deleteTemplate), agent, { method: 'DELETE', path: '/x', params: { id: brokerageId } })).status).toBe(404);
    expect((await call(h(patchTemplate), agent, { method: 'PATCH', path: '/x', params: { id: brokerageId }, body: { name: 'Hacked' } })).status).toBe(404);
    const before = (await admin.from('documents').select('id, storage_path').eq('transaction_id', deal.transactionId).eq('file_name', 'contract.pdf')).data!;
    expect((await call(h(deleteTemplate), agent, { method: 'DELETE', path: '/x', params: { id: txId } })).status).toBe(200);
    const after = (await admin.from('documents').select('id, storage_path').eq('transaction_id', deal.transactionId).eq('file_name', 'contract.pdf')).data!;
    expect(after).toHaveLength(before.length);
    const file = await admin.storage.from('transaction-documents').download(after[0].storage_path as string);
    expect(file.error).toBeNull();
  });
});

describe('adding library PDFs to a listing', () => {
  it('copies a PDF into the listing’s Documents and refuses what is not a PDF template', async () => {
    const created = await body(await upload(agent, { scope: 'state', state: 'TX', documentCategory: 'contract_disclosures', documentType: 'Listing Agreement', name: 'TX listing agreement' }));
    const email = await call(h(createTemplate), agent, { method: 'POST', path: '/api/templates', body: { kind: 'email', name: 'An email', subject: 's', body: 'b' } });
    const res = await call(h(addToListing), agent, { method: 'POST', path: '/api/templates/add-to-listing', body: { listingId, templateIds: [created.id, (email.json as { id: string }).id] } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const out = res.json as { added: { name: string }[]; skipped: { name: string }[] };
    expect(out.added.map((a) => a.name)).toEqual(['TX listing agreement']);
    expect(out.skipped.map((a) => a.name)).toEqual(['An email']);
    const { data } = await admin.from('listing_documents').select('file_name, document_type').eq('listing_id', listingId);
    expect(data).toEqual([{ file_name: 'contract.pdf', document_type: 'Listing Agreement' }]);
    expect((await call(h(addToListing), outsider, { method: 'POST', path: '/api/templates/add-to-listing', body: { listingId, templateIds: [created.id] } })).status).toBe(403);
  });
});

describe('state resource links', () => {
  it('are kept per person, only open pages, and never show up as PDF templates', async () => {
    const make = (who: Actor, b: Record<string, unknown>) => call(h(createLink), who, { method: 'POST', path: '/api/templates/state-links', body: b });
    expect((await make(agent, { state: 'XX', url: 'https://example.test' })).status).toBe(400);
    expect((await make(agent, { state: 'TX', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await make(agent, { state: 'TX', url: '' })).status).toBe(400);
    const ok = await make(agent, { state: 'TX', label: 'Association forms', url: 'forms.example.test/tx' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const link = ok.json as { id: string; url: string };
    expect(link.url).toBe('https://forms.example.test/tx');
    const mine = (await call(h(listLinks), agent, { method: 'GET', path: '/api/templates/state-links?state=TX' })).json as { id: string }[];
    expect(mine.map((l) => l.id)).toEqual([link.id]);
    expect(((await call(h(listLinks), outsider, { method: 'GET', path: '/api/templates/state-links' })).json as unknown[]).length).toBe(0);
    expect((await list(agent, '?kinds=form')).some((t) => t.name === 'Association forms')).toBe(false);
    await call(h(deleteLink), outsider, { method: 'DELETE', path: `/api/templates/state-links?id=${link.id}` });
    expect(((await call(h(listLinks), agent, { method: 'GET', path: '/api/templates/state-links' })).json as unknown[]).length).toBe(1);
    expect((await call(h(deleteLink), agent, { method: 'DELETE', path: `/api/templates/state-links?id=${link.id}` })).status).toBe(200);
    expect(((await call(h(listLinks), agent, { method: 'GET', path: '/api/templates/state-links' })).json as unknown[]).length).toBe(0);
  });
});
