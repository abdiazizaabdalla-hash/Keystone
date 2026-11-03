import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { POST as createTemplate } from '@/app/api/templates/route';
import { GET as listRules, POST as createRule } from '@/app/api/templates/[id]/rules/route';
import { PATCH as patchRule, DELETE as deleteRule } from '@/app/api/template-rules/[ruleId]/route';
import { GET as listRuns } from '@/app/api/template-runs/route';
import { POST as decide } from '@/app/api/template-runs/[runId]/decide/route';
import { POST as installStarters } from '@/app/api/templates/starters/route';
import { admin, call, cleanup, createActor, type Actor } from './helpers';

// Automatic rules: they make drafts, never send. Approving is the only thing that sends, and only to people on the deal.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let other: Actor;
let agentId: string;
let counter = 0;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  tc = await createActor('r-tc', { plan: 'pro' });
  other = await createActor('r-other', { plan: 'pro' });
  const a = await call(h(createAgent), tc, { method: 'POST', path: '/api/agents', body: { name: 'Rule Agent', email: 'ruleagent@example.test', flatFee: 0, percentFee: 0 } });
  agentId = (a.json as { id: string }).id;
});
afterAll(cleanup);

async function makeDeal(extra: Record<string, unknown> = {}) {
  counter++;
  const t = await call(h(createTransaction), tc, { method: 'POST', path: '/api/transactions', body: { agentId, propertyAddress: `${counter} Rule St, Austin, TX 78701`, purchasePrice: 300000, fileNumber: `RU-${counter}`, ...extra } });
  expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
  const id = ((t.json as { transaction?: { id: string } }).transaction?.id ?? (t.json as { id: string }).id) as string;
  await admin.from('transaction_contacts').insert([
    { transaction_id: id, role: 'Buyer', name: 'Riley Buyer', email: `riley${counter}@example.test`, position: 0 },
    { transaction_id: id, role: 'Lender', name: 'Lee Lender', email: `lee${counter}@example.test`, position: 1 },
  ]);
  return id;
}
const setStatus = (id: string, status: string) => call(h(patchTransaction), tc, { method: 'PATCH', path: `/api/transactions/x?id=${id}`, body: { status } });
const mkTemplate = async (body: Record<string, unknown> = {}) =>
  ((await call(h(createTemplate), tc, { method: 'POST', path: '/api/templates', body: { kind: 'email', name: `T${++counter}`, subject: 'Congrats on {{property_address}}', body: 'Hi {{client_first_name}}, congratulations!', ...body } })).json as { id: string }).id;
const addRule = (who: Actor, templateId: string, body: Record<string, unknown>) => call(h(createRule), who, { method: 'POST', path: `/api/templates/${templateId}/rules`, params: { id: templateId }, body });
const runs = async (who: Actor, status = 'pending') => ((await call(h(listRuns), who, { method: 'GET', path: `/api/template-runs?status=${status}` })).json as { runs: Array<{ id: string; template_id: string; transaction_id: string; subject: string; body: string; status: string; recipients: Array<{ email: string }> }> }).runs;
const decideRun = (who: Actor, runId: string, body: Record<string, unknown>) => call(h(decide), who, { method: 'POST', path: `/api/template-runs/${runId}/decide`, params: { runId }, body });

describe('making rules', () => {
  it('validates, and belongs to the template owner', async () => {
    const t = await mkTemplate();
    expect((await addRule(tc, t, { trigger_event: 'whenever' })).status).toBe(400);
    expect((await addRule(tc, t, { trigger_event: 'deal_closed', offset_days: 99999 })).status).toBe(400);
    expect((await addRule(tc, t, { trigger_event: 'deal_closed', recipient_roles: ['Wizard'] })).status).toBe(400);
    expect((await addRule(other, t, { trigger_event: 'deal_closed' })).status).toBe(404);
    const ok = await addRule(tc, t, { trigger_event: 'deal_closed', recipient_roles: ['buyer', 'Seller'] });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect((ok.json as { recipient_roles: string[] }).recipient_roles).toEqual(['Buyer', 'Seller']);
    expect(((await call(h(listRules), tc, { method: 'GET', path: '/api/x', params: { id: t } })).json as unknown[]).length).toBe(1);
  });
});

describe('drafts from "when the deal closes"', () => {
  it('appear when the deal is marked Closed, filled in, and send nothing', async () => {
    const t = await mkTemplate();
    await addRule(tc, t, { trigger_event: 'deal_closed', recipient_roles: ['Buyer'] });
    const deal = await makeDeal();
    expect((await runs(tc)).filter((r) => r.transaction_id === deal && r.template_id === t)).toHaveLength(0);
    expect((await setStatus(deal, 'Closed')).status).toBe(200);
    const mine = (await runs(tc)).filter((r) => r.transaction_id === deal && r.template_id === t);
    expect(mine).toHaveLength(1);
    const { data: tx } = await admin.from('transactions').select('property_address').eq('id', deal).single();
    expect(mine[0].subject).toBe(`Congrats on ${tx!.property_address}`);
    expect(mine[0].body).toContain('Hi Riley,');
    expect(mine[0].recipients.map((r) => r.email)).toEqual([expect.stringMatching(/^riley\d+@example\.test$/)]);
    const { data: sent } = await admin.from('email_outbox').select('id').eq('owner_user_id', tc.id);
    expect(sent ?? []).toHaveLength(0);
    // checking again, and re-saving the status, never makes a second draft
    await setStatus(deal, 'Closed');
    expect((await runs(tc)).filter((r) => r.transaction_id === deal && r.template_id === t)).toHaveLength(1);
  });

  it('are not made while a rule is switched off, and appear once it is on', async () => {
    const t = await mkTemplate();
    const rule = (await addRule(tc, t, { trigger_event: 'deal_closed', enabled: false })).json as { id: string };
    const deal = await makeDeal();
    await setStatus(deal, 'Closed');
    const mineOf = async () => (await runs(tc)).filter((r) => r.transaction_id === deal && r.template_id === t);
    expect(await mineOf()).toHaveLength(0);
    await call(h(patchRule), tc, { method: 'PATCH', path: `/api/template-rules/${rule.id}`, params: { ruleId: rule.id }, body: { enabled: true } });
    expect(await mineOf()).toHaveLength(1);
  });

  it('skip a template that is for other states', async () => {
    const t = await mkTemplate({ states: ['CA'] });
    await addRule(tc, t, { trigger_event: 'deal_closed' });
    const deal = await makeDeal();
    await setStatus(deal, 'Closed');
    const forDeal = (await runs(tc)).filter((r) => r.transaction_id === deal);
    // the California-only template made no draft: every draft here comes from the earlier Texas-friendly rules
    expect(forDeal.length).toBe(forDeal.filter((r) => r.subject.startsWith('Congrats on')).length);
    const caTemplateRule = (await admin.from('template_rules').select('id').eq('template_id', t).single()).data!.id as string;
    expect((await admin.from('template_runs').select('id').eq('rule_id', caTemplateRule)).data ?? []).toHaveLength(0);
  });
});

describe('dates', () => {
  it('an acceptance-date rule drafts on the day', async () => {
    const t = await mkTemplate({ subject: 'Welcome', body: 'Welcome aboard' });
    await addRule(tc, t, { trigger_event: 'acceptance_date', offset_days: 0, recipient_roles: ['Buyer'] });
    const deal = await makeDeal({ acceptanceDate: today });
    await call(h(patchTransaction), tc, { method: 'PATCH', path: `/api/transactions/x?id=${deal}`, body: { acceptanceDate: today } });
    const welcome = (await runs(tc)).filter((r) => r.transaction_id === deal && r.subject === 'Welcome');
    expect(welcome).toHaveLength(1);
  });
});

describe('approving', () => {
  let runId: string;
  beforeAll(async () => {
    const t = await mkTemplate({ subject: 'Approve me', body: 'Hi {{client_first_name}}' });
    await addRule(tc, t, { trigger_event: 'deal_closed', recipient_roles: ['Buyer'] });
    const deal = await makeDeal();
    await setStatus(deal, 'Closed');
    runId = (await runs(tc)).find((r) => r.transaction_id === deal && r.subject === 'Approve me')!.id;
  });

  it('only the owner can see or decide it', async () => {
    expect((await runs(other)).find((r) => r.id === runId)).toBeUndefined();
    expect((await decideRun(other, runId, { action: 'approve' })).status).toBe(404);
  });

  it('refuses a recipient who is not on the deal, and a missing message', async () => {
    expect((await decideRun(tc, runId, { action: 'approve', to: ['stranger@elsewhere.test'] })).status).toBe(400);
    expect((await decideRun(tc, runId, { action: 'approve', body: '   ' })).status).toBe(400);
    expect((await decideRun(tc, runId, { action: 'maybe' })).status).toBe(400);
  });

  it('sends once (to the test outbox) and then is done', async () => {
    const res = await decideRun(tc, runId, { action: 'approve', body: 'Hi Riley, edited by me' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const { data } = await admin.from('email_outbox').select('subject, body, source').eq('owner_user_id', tc.id).eq('subject', 'Approve me');
    expect(data).toHaveLength(1);
    expect(data![0].body).toBe('Hi Riley, edited by me');
    expect(data![0].source).toBe('rule');
    expect((await decideRun(tc, runId, { action: 'approve' })).status).toBe(409);
    expect((await runs(tc, 'sent')).some((r) => r.id === runId)).toBe(true);
    expect((await runs(tc)).some((r) => r.id === runId)).toBe(false);
  });

  it('can be dismissed, which sends nothing', async () => {
    const t = await mkTemplate({ subject: 'Dismiss me' });
    await addRule(tc, t, { trigger_event: 'deal_closed', recipient_roles: ['Buyer'] });
    const deal = await makeDeal();
    await setStatus(deal, 'Closed');
    const id = (await runs(tc)).find((r) => r.transaction_id === deal && r.subject === 'Dismiss me')!.id;
    expect((await decideRun(tc, id, { action: 'dismiss' })).status).toBe(200);
    const { data } = await admin.from('email_outbox').select('id').eq('owner_user_id', tc.id).eq('subject', 'Dismiss me');
    expect(data ?? []).toHaveLength(0);
  });

  it('a draft with nobody to send to cannot be approved', async () => {
    const t = await mkTemplate({ subject: 'Nobody' });
    await addRule(tc, t, { trigger_event: 'deal_closed', recipient_roles: ['Seller'] }); // the deal has no seller
    const deal = await makeDeal();
    await setStatus(deal, 'Closed');
    const run = (await runs(tc)).find((r) => r.transaction_id === deal && r.subject === 'Nobody')!;
    expect(run.recipients).toHaveLength(0);
    expect((await decideRun(tc, run.id, { action: 'approve' })).status).toBe(400);
  });
});

describe('deleting a rule', () => {
  it('clears the drafts that were waiting', async () => {
    const t = await mkTemplate({ subject: 'Going away' });
    const rule = (await addRule(tc, t, { trigger_event: 'deal_closed' })).json as { id: string };
    const deal = await makeDeal();
    await setStatus(deal, 'Closed');
    expect((await runs(tc)).some((r) => r.transaction_id === deal && r.subject === 'Going away')).toBe(true);
    expect((await call(h(deleteRule), other, { method: 'DELETE', path: `/api/template-rules/${rule.id}`, params: { ruleId: rule.id } })).status).toBe(404);
    expect((await call(h(deleteRule), tc, { method: 'DELETE', path: `/api/template-rules/${rule.id}`, params: { ruleId: rule.id } })).status).toBe(200);
    expect((await runs(tc)).some((r) => r.transaction_id === deal && r.subject === 'Going away')).toBe(false);
  });
});

describe('starter pack rules', () => {
  it('come with their suggested rules switched off', async () => {
    await call(h(installStarters), other, { method: 'POST', path: '/api/templates/starters', body: {} });
    const { data } = await admin.from('template_rules').select('enabled, trigger_event').eq('owner_user_id', other.id);
    expect((data ?? []).length).toBeGreaterThanOrEqual(5);
    expect((data ?? []).every((r) => r.enabled === false)).toBe(true);
    expect((data ?? []).some((r) => r.trigger_event === 'deal_closed')).toBe(true);
  });
});
