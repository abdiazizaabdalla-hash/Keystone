import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/templates/route';
import { POST as uploadFile } from '@/app/api/templates/[id]/file/route';
import { POST as renderTemplate } from '@/app/api/templates/[id]/render/route';
import { POST as applyTemplate } from '@/app/api/templates/[id]/apply/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Using a template on a deal: the deal's details fill in; the email goes (to the test outbox), the letter becomes a
// PDF in Documents, the form is copied into Documents. Only the owner of both template and deal can do it.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let other: Actor;
let free: Actor;
let dealId: string;
let emailId: string;
let letterId: string;
let formId: string;

const make = async (who: Actor, body: Record<string, unknown>) => ((await call(h(createTemplate), who, { method: 'POST', path: '/api/templates', body })).json as { id: string }).id;
const render = (who: Actor, id: string, body: Record<string, unknown>) => call(h(renderTemplate), who, { method: 'POST', path: `/api/templates/${id}/render`, params: { id }, body });
const apply = (who: Actor, id: string, body: Record<string, unknown>) => call(h(applyTemplate), who, { method: 'POST', path: `/api/templates/${id}/apply`, params: { id }, body });

beforeAll(async () => {
  tc = await createActor('u-tc', { plan: 'pro' });
  other = await createActor('u-other', { plan: 'pro' });
  free = await createCollaborator('u-free');
  const a = await call(h(createAgent), tc, { method: 'POST', path: '/api/agents', body: { name: 'Pat Agent', email: 'pat@example.test', flatFee: 0, percentFee: 0 } });
  const t = await call(h(createTransaction), tc, { method: 'POST', path: '/api/transactions', body: { agentId: (a.json as { id: string }).id, propertyAddress: '12 Oak St, Austin, TX 78701', purchasePrice: 350000, fileNumber: 'TU-1', acceptanceDate: '2026-03-01' } });
  expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
  dealId = ((t.json as { transaction?: { id: string } }).transaction?.id ?? (t.json as { id: string }).id) as string;
  await admin.from('transaction_contacts').insert([
    { transaction_id: dealId, role: 'Buyer', name: 'Sam Buyer', email: 'sam@example.test', position: 0 },
    { transaction_id: dealId, role: 'Lender', name: 'Lee Lender', email: 'lee@example.test', position: 1 },
  ]);
  emailId = await make(tc, { kind: 'email', name: 'Hello', subject: 'About {{property_address}}', body: 'Hi {{client_first_name}}, closing is {{closing_date}}. From {{my_name}}', states: ['TX'] });
  letterId = await make(tc, { kind: 'letter', name: 'Summary letter', subject: 'Summary', body: 'Deal {{file_number}} at {{property_address}}, agent {{agent_name}}.' });
  formId = await make(tc, { kind: 'form', name: 'My form', states: ['TX'] });
});
afterAll(cleanup);

describe('filling in a template from a deal', () => {
  it('uses the client, address and agent, and reports what the deal lacks', async () => {
    const res = await render(tc, emailId, { transactionId: dealId });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const r = res.json as { subject: string; body: string; missing: string[]; fitsState: boolean; dealState: string; recipients: Array<{ email: string; category: string }> };
    expect(r.subject).toBe('About 12 Oak St, Austin, TX 78701');
    expect(r.body).toContain('Hi Sam,');
    expect(r.missing).toEqual(['closing_date']);
    expect(r.dealState).toBe('TX');
    expect(r.fitsState).toBe(true);
    expect(r.recipients.map((p) => p.email).sort()).toEqual(['lee@example.test', 'pat@example.test', 'sam@example.test']);
  });

  it('flags a template meant for other states', async () => {
    const ca = await make(tc, { kind: 'email', name: 'CA only', body: 'x', states: ['CA'] });
    expect(((await render(tc, ca, { transactionId: dealId })).json as { fitsState: boolean }).fitsState).toBe(false);
  });

  it('is closed to anyone else', async () => {
    expect((await render(other, emailId, { transactionId: dealId })).status).toBe(404);
    const theirs = await make(other, { kind: 'email', name: 'Theirs', body: 'x' });
    expect((await render(other, theirs, { transactionId: dealId })).status).toBeGreaterThanOrEqual(403);
    expect((await render(free, emailId, { transactionId: dealId })).status).toBe(403);
    expect((await render(tc, emailId, {})).status).toBe(400);
  });
});

describe('sending an email', () => {
  it('goes to the test outbox with the people chosen', async () => {
    const res = await apply(tc, emailId, { transactionId: dealId, action: 'send', to: ['sam@example.test'], subject: 'Hello Sam', body: 'Hi Sam' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect((res.json as { mode: string }).mode).toBe('outbox');
    const { data } = await admin.from('email_outbox').select('*').eq('owner_user_id', tc.id);
    expect(data).toHaveLength(1);
    expect(data![0].to_emails).toEqual(['sam@example.test']);
    expect(data![0].subject).toBe('Hello Sam');
    expect(data![0].source).toBe('template');
  });

  it('refuses bad input and the wrong kind of template', async () => {
    expect((await apply(tc, emailId, { transactionId: dealId, action: 'send', to: [], subject: 's', body: 'b' })).status).toBe(400);
    expect((await apply(tc, emailId, { transactionId: dealId, action: 'send', to: ['nope'], subject: 's', body: 'b' })).status).toBe(400);
    expect((await apply(tc, emailId, { transactionId: dealId, action: 'send', to: ['a@b.co'], subject: '', body: 'b' })).status).toBe(400);
    expect((await apply(tc, letterId, { transactionId: dealId, action: 'send', to: ['a@b.co'], subject: 's', body: 'b' })).status).toBe(400);
    expect((await apply(other, emailId, { transactionId: dealId, action: 'send', to: ['a@b.co'], subject: 's', body: 'b' })).status).toBe(404);
    expect((await apply(free, emailId, { transactionId: dealId, action: 'send', to: ['a@b.co'], subject: 's', body: 'b' })).status).toBe(403);
  });
});

describe('letters and forms into Documents', () => {
  it('saves a letter as a PDF on the deal', async () => {
    const res = await apply(tc, letterId, { transactionId: dealId, action: 'save_pdf', subject: 'Summary', body: 'Deal TU-1 at 12 Oak St' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const { data } = await admin.from('documents').select('file_name, content_type, file_size').eq('transaction_id', dealId);
    expect(data).toHaveLength(1);
    expect(data![0].file_name).toBe('Summary letter.pdf');
    expect(data![0].content_type).toBe('application/pdf');
    expect(data![0].file_size).toBeGreaterThan(200);
  });

  it('remembers what was used, newest first, for the quick-access shortcuts', async () => {
    const res = await call(h(listTemplates), tc, { method: 'GET', path: '/api/templates?kinds=letter,form&recent=4' });
    const names = (res.json as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(['Summary letter']);
    const emails = await call(h(listTemplates), tc, { method: 'GET', path: '/api/templates?kinds=email&recent=4' });
    expect((emails.json as Array<{ name: string }>).map((t) => t.name)).toEqual(['Hello']);
    expect(((await call(h(listTemplates), other, { method: 'GET', path: '/api/templates?recent=4' })).json as unknown[]).length).toBe(0);
  });

  it('copies an uploaded form onto the deal, and asks for the file first', async () => {
    expect((await apply(tc, formId, { transactionId: dealId, action: 'attach_form' })).status).toBe(400);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'tx-contract.pdf', { type: 'application/pdf' }));
    const up = await uploadFile(new NextRequest(`http://localhost/api/templates/${formId}/file`, { method: 'POST', headers: { authorization: `Bearer ${tc.token}` }, body: fd }), { params: Promise.resolve({ id: formId }) });
    expect(up.status).toBe(200);
    const res = await apply(tc, formId, { transactionId: dealId, action: 'attach_form' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const { data } = await admin.from('documents').select('file_name').eq('transaction_id', dealId);
    expect(data!.map((d) => d.file_name).sort()).toEqual(['Summary letter.pdf', 'tx-contract.pdf']);
  });
});
