import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as agentProfile } from '@/app/api/oversight/agents/[id]/route';
import { GET as deals } from '@/app/api/oversight/deals/route';
import { GET as listInvoices, POST as createInvoice } from '@/app/api/workspace-invoices/route';
import { GET as templatesList } from '@/app/api/templates/route';
import { GET as runsList } from '@/app/api/template-runs/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// What a brokerage owner sees on Transactions, an agent's profile and Invoices -- and nobody else.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const profile = (who: Actor | null, id: string) => call(h(agentProfile), who, { method: 'GET', path: '/x', params: { id } });

let broker: Actor;
let otherBroker: Actor;
let agentA: Actor;
let agentB: Actor;
let pro: Actor;
let dealA: Deal;

beforeAll(async () => {
  broker = await createActor('ov-broker', { plan: 'team' });
  otherBroker = await createActor('ov-other', { plan: 'brokerage' });
  agentA = await createActor('ov-a', { role: 'agent', agent_workspace: true });
  agentB = await createActor('ov-b', { role: 'agent', agent_workspace: true });
  pro = await createActor('ov-pro', { plan: 'pro' });
  dealA = await seedDeal(agentA, 'OVA');
  await seedDeal(agentB, 'OVB');
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agentA.id, invited_email: agentA.email, status: 'active', default_split_type: 'percent', default_split_value: 75 });
  await admin.from('brokerage_links').insert({ owner_user_id: otherBroker.id, agent_user_id: agentB.id, invited_email: agentB.email, status: 'active' });
  await admin.from('tasks').insert([
    { transaction_id: dealA.transactionId, name: 'Order inspection', completed: false, due_date: '2030-01-10', sort_order: 2 },
    { transaction_id: dealA.transactionId, name: 'Earnest money', completed: false, due_date: '2030-01-05', sort_order: 1 },
    { transaction_id: dealA.transactionId, name: 'Contract signed', completed: true, due_date: null, sort_order: 0 },
  ]);
}, 90_000);
afterAll(cleanup);

describe('agent profile', () => {
  it('shows the owner their own agent in full, with the base commission and next steps', async () => {
    const res = await profile(broker, agentA.id);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const j = res.json as { agent: { id: string; baseCommission: { type: string; value: number } | null; email: string }; openDeals: Array<{ id: string; nextStep: { name: string } | null; tasksTotal: number; tasksDone: number }> };
    expect(j.agent.id).toBe(agentA.id);
    expect(j.agent.baseCommission).toEqual({ type: 'percent', value: 75 });
    const d = j.openDeals.find((x) => x.id === dealA.transactionId);
    expect(d?.nextStep?.name).toBe('Earnest money');
    expect(d?.tasksTotal).toBe(4);
  });

  it('is a 404 for another brokerage’s agent, 403 for non-owners, 401 without a login', async () => {
    expect((await profile(broker, agentB.id)).status).toBe(404);
    expect((await profile(otherBroker, agentA.id)).status).toBe(404);
    expect((await profile(pro, agentA.id)).status).toBe(403);
    expect((await profile(agentA, agentA.id)).status).toBe(403);
    expect((await profile(null, agentA.id)).status).toBe(401);
  });

  it('is off (404) when the brokerage feature is off', async () => {
    const saved = process.env.RELAY_FEATURES;
    process.env.RELAY_FEATURES = 'agent_workspace,templates';
    try {
      expect((await profile(broker, agentA.id)).status).toBe(404);
    } finally {
      process.env.RELAY_FEATURES = saved;
    }
  });
});

describe('agents’ deals list', () => {
  it('carries the next step and progress, and only this owner’s agents', async () => {
    const res = await call(h(deals), broker, { method: 'GET', path: '/api/oversight/deals?show=all' });
    expect(res.status).toBe(200);
    const list = res.json as Array<{ id: string; agent: { id: string }; nextStep: { name: string } | null; tasksDone: number }>;
    expect(list.every((d) => d.agent.id === agentA.id)).toBe(true);
    expect(list.find((d) => d.id === dealA.transactionId)?.nextStep?.name).toBe('Earnest money');
    expect(list.find((d) => d.id === dealA.transactionId)?.tasksDone).toBe(1);
  });
});

describe('invoices to anyone', () => {
  it('a brokerage owner can write and list free-form invoices; a Pro coordinator still cannot', async () => {
    const made = await call(h(createInvoice), broker, { method: 'POST', path: '/api/workspace-invoices', body: { templateKey: 'commission_split', billToName: 'Agent A', billToEmail: 'a@example.test' } });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    const list = await call(h(listInvoices), broker, { method: 'GET', path: '/api/workspace-invoices' });
    expect(list.status).toBe(200);
    expect((list.json as unknown[]).length).toBe(1);
    expect((await call(h(createInvoice), pro, { method: 'POST', path: '/api/workspace-invoices', body: { templateKey: 'blank' } })).status).toBe(403);
    // Another owner never sees it.
    expect(((await call(h(listInvoices), otherBroker, { method: 'GET', path: '/api/workspace-invoices' })).json as unknown[]).length).toBe(0);
  });
});

describe('templates stay quick to open', () => {
  it('?counts=1 answers with just the two numbers', async () => {
    const res = await call(h(templatesList), broker, { method: 'GET', path: '/api/templates?counts=1' });
    expect(res.status).toBe(200);
    const j = res.json as { documents: number; emails: number };
    expect(typeof j.documents).toBe('number');
    expect(typeof j.emails).toBe('number');
  });
  it('?countOnly=1 returns the pending number without running the rules', async () => {
    const res = await call(h(runsList), broker, { method: 'GET', path: '/api/template-runs?countOnly=1' });
    expect(res.status).toBe(200);
    expect(typeof (res.json as { pending: number }).pending).toBe('number');
  });
});
