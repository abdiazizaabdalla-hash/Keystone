import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/templates/route';
import { GET as getTemplate, PATCH as patchTemplate, DELETE as deleteTemplate } from '@/app/api/templates/[id]/route';
import { GET as fileLink, POST as uploadFile } from '@/app/api/templates/[id]/file/route';
import { GET as listStarters, POST as installStarters } from '@/app/api/templates/starters/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { STARTER_TEMPLATES } from '@/lib/templateStarters';
import { call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Templates library: private to the owner, filtered by state, own forms uploaded, starters installed safely.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let tc2: Actor;
let free: Actor;

beforeAll(async () => {
  tc = await createActor('t-tc', { plan: 'pro' });
  tc2 = await createActor('t-tc2', { plan: 'pro' });
  free = await createCollaborator('t-free');
});
afterAll(cleanup);

const create = (who: Actor, body: Record<string, unknown>) => call(h(createTemplate), who, { method: 'POST', path: '/api/templates', body });
const list = (who: Actor, qs = '') => call(h(listTemplates), who, { method: 'GET', path: `/api/templates${qs}` });
const one = (fn: unknown, who: Actor, id: string, method: string, body?: unknown) => call(h(fn), who, { method, path: `/api/templates/${id}`, params: { id }, body });
const idOf = (r: { json: unknown }) => (r.json as { id: string }).id;

describe('who can use templates', () => {
  it('needs a signed-in coordinator or workspace agent, not a free invited agent', async () => {
    expect((await call(h(listTemplates), null, { method: 'GET', path: '/api/templates' })).status).toBe(401);
    expect((await list(free)).status).toBe(403);
    expect((await create(free, { kind: 'email', name: 'x' })).status).toBe(403);
  });
});

describe('creating and editing', () => {
  it('validates kind, name and states', async () => {
    expect((await create(tc, { kind: 'poem', name: 'x' })).status).toBe(400);
    expect((await create(tc, { kind: 'email', name: '  ' })).status).toBe(400);
    expect((await create(tc, { kind: 'email', name: 'Bad', states: ['ZZ'] })).status).toBe(400);
  });

  it('keeps what you save and lets you change it', async () => {
    const res = await create(tc, { kind: 'email', name: 'Thanks', subject: 'Thanks {{client_name}}', body: 'Hello', states: ['tx'], category: 'Post Closing' });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const t = res.json as { id: string; states: string[]; category: string };
    expect(t.states).toEqual(['TX']);
    expect(t.category).toBe('post_closing');
    const patched = await one(patchTemplate, tc, t.id, 'PATCH', { body: 'Hello again', states: ['TX', 'OK'] });
    expect(patched.status).toBe(200);
    expect((patched.json as { body: string; states: string[] }).states).toEqual(['TX', 'OK']);
    expect((await one(getTemplate, tc, t.id, 'GET')).status).toBe(200);
  });
});

describe('filtering by state', () => {
  it('shows the state templates and the all-state ones', async () => {
    await create(tc, { kind: 'email', name: 'All states one', body: 'a' });
    await create(tc, { kind: 'form', name: 'California disclosure', states: ['CA'] });
    const tx = (await list(tc, '?state=TX')).json as Array<{ name: string }>;
    const names = tx.map((t) => t.name);
    expect(names).toContain('Thanks');
    expect(names).toContain('All states one');
    expect(names).not.toContain('California disclosure');
    const ca = ((await list(tc, '?state=CA')).json as Array<{ name: string }>).map((t) => t.name);
    expect(ca).toContain('California disclosure');
    expect(ca).not.toContain('Thanks');
  });

  it('filters by kind and search text', async () => {
    const forms = (await list(tc, '?kind=form')).json as Array<{ kind: string }>;
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.every((t) => t.kind === 'form')).toBe(true);
    const found = (await list(tc, '?q=california')).json as Array<{ name: string }>;
    expect(found.map((t) => t.name)).toEqual(['California disclosure']);
  });
});

describe('privacy', () => {
  it('another coordinator cannot see, change or delete mine', async () => {
    const id = idOf(await create(tc, { kind: 'letter', name: 'Mine only', body: 'private' }));
    expect(((await list(tc2)).json as unknown[]).length).toBe(0);
    expect((await one(getTemplate, tc2, id, 'GET')).status).toBe(404);
    expect((await one(patchTemplate, tc2, id, 'PATCH', { name: 'Hijack' })).status).toBe(404);
    expect((await one(deleteTemplate, tc2, id, 'DELETE')).status).toBe(404);
    expect((await one(getTemplate, tc, id, 'GET')).status).toBe(200);
  });

  it('archives and deletes', async () => {
    const id = idOf(await create(tc, { kind: 'letter', name: 'Old letter' }));
    await one(patchTemplate, tc, id, 'PATCH', { archived: true });
    expect(((await list(tc)).json as Array<{ id: string }>).some((t) => t.id === id)).toBe(false);
    expect(((await list(tc, '?archived=1')).json as Array<{ id: string }>).some((t) => t.id === id)).toBe(true);
    expect((await one(deleteTemplate, tc, id, 'DELETE')).status).toBe(200);
    expect((await one(getTemplate, tc, id, 'GET')).status).toBe(404);
  });
});

describe('own forms', () => {
  const upload = async (who: Actor, id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const req = new NextRequest(`http://localhost/api/templates/${id}/file`, { method: 'POST', headers: { authorization: `Bearer ${who.token}` }, body: fd });
    const res = await uploadFile(req, { params: Promise.resolve({ id }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it('attaches a PDF to a form template and gives a link back', async () => {
    const id = idOf(await create(tc, { kind: 'form', name: 'My TX contract', states: ['TX'] }));
    const pdf = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], 'contract.pdf', { type: 'application/pdf' });
    const res = await upload(tc, id, pdf);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.file_name).toBe('contract.pdf');
    const link = await call(h(fileLink), tc, { method: 'GET', path: `/api/templates/${id}/file`, params: { id } });
    expect(link.status).toBe(200);
    expect((link.json as { url: string }).url).toMatch(/^https?:/);
    expect((await call(h(fileLink), tc2, { method: 'GET', path: `/api/templates/${id}/file`, params: { id } })).status).toBe(404);
  });

  it('refuses the wrong file type, an email template, and someone else’s template', async () => {
    const formId = idOf(await create(tc, { kind: 'form', name: 'Form two' }));
    const exe = new File([new Uint8Array([1, 2, 3])], 'x.exe', { type: 'application/x-msdownload' });
    expect((await upload(tc, formId, exe)).status).toBe(400);
    const emailId = idOf(await create(tc, { kind: 'email', name: 'Email no file' }));
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'a.pdf', { type: 'application/pdf' });
    expect((await upload(tc, emailId, pdf)).status).toBe(400);
    expect((await upload(tc2, formId, pdf)).status).toBe(404);
  });
});

describe('starter pack', () => {
  it('lists, installs once, and never duplicates', async () => {
    const before = (await call(h(listStarters), tc2, { method: 'GET', path: '/api/templates/starters' })).json as Array<{ installed: boolean }>;
    expect(before).toHaveLength(STARTER_TEMPLATES.length);
    expect(before.every((s) => !s.installed)).toBe(true);
    const first = await call(h(installStarters), tc2, { method: 'POST', path: '/api/templates/starters', body: {} });
    expect((first.json as { added: number }).added).toBe(STARTER_TEMPLATES.length);
    const second = await call(h(installStarters), tc2, { method: 'POST', path: '/api/templates/starters', body: {} });
    expect((second.json as { added: number }).added).toBe(0);
    expect(((await list(tc2)).json as unknown[]).length).toBe(STARTER_TEMPLATES.length);
  });

  it('can install just the ones you pick', async () => {
    const res = await call(h(installStarters), tc, { method: 'POST', path: '/api/templates/starters', body: { keys: [STARTER_TEMPLATES[0].key] } });
    expect((res.json as { added: number }).added).toBe(1);
  });
});

describe('the state of a deal', () => {
  it('is guessed from the address, can be set, and rejects nonsense', async () => {
    const a = await call(h(createAgent), tc, { method: 'POST', path: '/api/agents', body: { name: 'State Agent', email: 'stateagent@example.test', flatFee: 0, percentFee: 0 } });
    const agentId = (a.json as { id: string }).id;
    const t = await call(h(createTransaction), tc, { method: 'POST', path: '/api/transactions', body: { agentId, propertyAddress: '12 Oak St, Austin, TX 78701', purchasePrice: 300000, fileNumber: 'ST-1' } });
    expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
    const tx = ((t.json as { transaction?: Record<string, unknown> }).transaction ?? t.json) as { id: string; property_state: string | null };
    expect(tx.property_state).toBe('TX');
    const set = await call(h(patchTransaction), tc, { method: 'PATCH', path: `/api/transactions/x?id=${tx.id}`, body: { propertyState: 'OK' } });
    expect(set.status, JSON.stringify(set.json)).toBe(200);
    expect((set.json as { property_state: string }).property_state).toBe('OK');
    const bad = await call(h(patchTransaction), tc, { method: 'PATCH', path: `/api/transactions/x?id=${tx.id}`, body: { propertyState: 'ZZ' } });
    expect(bad.status).toBe(400);
    const cleared = await call(h(patchTransaction), tc, { method: 'PATCH', path: `/api/transactions/x?id=${tx.id}`, body: { propertyState: '' } });
    expect((cleared.json as { property_state: string | null }).property_state).toBeNull();
  });
});
