import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/commissions/route';
import { PATCH } from '@/app/api/commissions/[id]/route';
import { GET as statement } from '@/app/api/commissions/[id]/statement/route';
import { PATCH as setDefault } from '@/app/api/oversight/[id]/route';
import { admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Commission splits: the owner proposes per deal, the agent agrees, the owner records payment. Only those two ever see it.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const forDeal = (who: Actor | null, id: string) => call(h(GET), who, { method: 'GET', path: `/api/commissions?transaction=${id}` });
const ledger = (who: Actor | null) => call(h(GET), who, { method: 'GET', path: '/api/commissions' });
const propose = (who: Actor | null, body: Record<string, unknown>) => call(h(POST), who, { method: 'POST', path: '/api/commissions', body });
const act = (who: Actor | null, id: string, body: Record<string, unknown>) => call(h(PATCH), who, { method: 'PATCH', path: '/x', params: { id }, body });
const pdf = (who: Actor | null, id: string) => statement(new NextRequest('http://localhost/x', { headers: who ? { authorization: `Bearer ${who.token}` } : {} }), { params: Promise.resolve({ id }) });

let broker: Actor;
let otherBroker: Actor;
let teammate: Actor;
let agentA: Actor;
let agentB: Actor;
let free: Actor;
let dealA: Deal;
let dealA2: Deal;
let dealB: Deal;
let linkId = '';
let id = '';

type View = { id: string; status: string; statementNumber: string; agentNet: number; brokerageNet: number; gross: number; changeNote: string | null; paymentPreference: string | null };
const body = (r: { json: unknown }) => r.json as View;

beforeAll(async () => {
  broker = await createActor('cm-broker', { plan: 'team' });
  otherBroker = await createActor('cm-other', { plan: 'brokerage' });
  teammate = await createActor('cm-mate', { plan: 'starter' });
  agentA = await createActor('cm-a', { role: 'agent', agent_workspace: true });
  agentB = await createActor('cm-b', { role: 'agent', agent_workspace: true });
  free = await createCollaborator('cm-free');
  dealA = await seedDeal(agentA, 'CMA');
  dealA2 = await seedDeal(agentA, 'CMA2');
  dealB = await seedDeal(agentB, 'CMB');
  const { data: team } = await admin.from('teams').insert({ owner_id: broker.id }).select('id').single();
  await admin.from('team_members').insert([{ team_id: team!.id, user_id: broker.id, role: 'owner' }, { team_id: team!.id, user_id: teammate.id, role: 'member' }]);
  const { data: link } = await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agentA.id, invited_email: agentA.email, status: 'active' }).select('id').single();
  linkId = link!.id as string;
  await admin.from('brokerage_links').insert({ owner_user_id: otherBroker.id, agent_user_id: agentB.id, invited_email: agentB.email, status: 'active' });
}, 90_000);
afterAll(cleanup);

describe('access', () => {
  it('is off (404) when the brokerage feature is off', async () => {
    const saved = process.env.RELAY_FEATURES;
    process.env.RELAY_FEATURES = 'agent_workspace,templates';
    try {
      expect((await ledger(broker)).status).toBe(404);
      expect((await propose(broker, { transactionId: dealA.transactionId, gross: 1000, splitType: 'percent', splitValue: 80 })).status).toBe(404);
    } finally {
      process.env.RELAY_FEATURES = saved;
    }
  });

  it('needs a login, and only owners on a Team or Brokerage plan can propose', async () => {
    expect((await ledger(null)).status).toBe(401);
    for (const who of [agentA, teammate, free]) expect((await propose(who, { transactionId: dealA.transactionId, gross: 1000, splitType: 'percent', splitValue: 80 })).status).toBe(403);
  });

  it('refuses a deal the owner does not oversee', async () => {
    expect((await propose(broker, { transactionId: dealB.transactionId, gross: 1000, splitType: 'percent', splitValue: 80 })).status).toBe(404);
    expect((await propose(otherBroker, { transactionId: dealA.transactionId, gross: 1000, splitType: 'percent', splitValue: 80 })).status).toBe(404);
    expect((await propose(broker, { transactionId: '00000000-0000-0000-0000-000000000000', gross: 1000, splitType: 'percent', splitValue: 80 })).status).toBe(404);
  });
});

describe('default split', () => {
  it('is validated, saved per agent, and clearable', async () => {
    const set = (b: Record<string, unknown>, who: Actor = broker, lid = linkId) => call(h(setDefault), who, { method: 'PATCH', path: '/x', params: { id: lid }, body: b });
    expect((await set({ splitType: 'percent', splitValue: 101 })).status).toBe(400);
    expect((await set({ splitType: 'nope', splitValue: 1 })).status).toBe(400);
    expect((await set({ splitType: 'flat_agent', splitValue: -5 })).status).toBe(400);
    expect((await set({ splitType: 'percent', splitValue: 80 }, otherBroker)).status).toBe(404);
    expect((await set({ splitType: 'percent', splitValue: 80 }, agentA)).status).toBe(403);
    expect((await set({ splitType: 'percent', splitValue: 80 })).status).toBe(200);
    const roster = (await ledger(broker)).json as { agents: { id: string; defaultSplit: { type: string; value: number } | null }[] };
    expect(roster.agents.find((a) => a.id === agentA.id)?.defaultSplit).toEqual({ type: 'percent', value: 80 });
    expect((await set({ splitType: null })).status).toBe(200);
    expect(((await ledger(broker)).json as { agents: { defaultSplit: unknown }[] }).agents[0].defaultSplit).toBeNull();
  });
});

describe('proposing', () => {
  it('rejects a split that makes no sense', async () => {
    const t = dealA.transactionId;
    for (const b of [
      { gross: 0, splitType: 'percent', splitValue: 80 },
      { gross: 1000, splitType: 'percent', splitValue: 120 },
      { gross: 1000, splitType: 'flat_agent', splitValue: 2000 },
      { gross: 1000, splitType: 'percent', splitValue: 50, deductions: [{ label: 'Fee', amount: 900 }] },
      { gross: 1000, splitType: 'percent', splitValue: 50, deductions: [{ label: '', amount: 5 }] },
      { gross: 1000 }, // no split and no default
    ]) expect((await propose(broker, { transactionId: t, ...b })).status).toBe(400);
    expect((await ledger(broker)).json).toMatchObject({ asOwner: [] });
  });

  it('creates a statement, computes the net amounts, and tells the agent', async () => {
    const res = await propose(broker, { transactionId: dealA.transactionId, gross: 10000, splitType: 'percent', splitValue: 80, deductions: [{ label: 'Transaction fee', amount: 395 }] });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const v = body(res);
    id = v.id;
    expect(v.statementNumber).toBe('COMM-0001');
    expect(v.status).toBe('proposed');
    expect(v.agentNet).toBe(7605);
    expect(v.brokerageNet).toBe(2395);
    const bell = (await admin.from('notifications').select('title, link').eq('recipient_user_id', agentA.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.length).toBe(1);
    expect(bell[0].link).toBe(`/dashboard/transactions/${dealA.transactionId}`);
  });

  it('uses the agent’s default split when none is given, and numbers statements in order', async () => {
    await call(h(setDefault), broker, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { splitType: 'flat_brokerage', splitValue: 500 } });
    const res = await propose(broker, { transactionId: dealA2.transactionId, gross: 6000 });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(body(res).statementNumber).toBe('COMM-0002');
    expect(body(res).brokerageNet).toBe(500);
    expect(body(res).agentNet).toBe(5500);
  });
});

describe('who can see it', () => {
  it('the owner and the deal’s agent, and nobody else', async () => {
    expect(((await forDeal(broker, dealA.transactionId)).json as { role: string; canPropose: boolean }).role).toBe('owner');
    expect(((await forDeal(agentA, dealA.transactionId)).json as { role: string; commission: View }).commission.id).toBe(id);
    for (const who of [teammate, otherBroker, agentB, free]) {
      const r = await forDeal(who, dealA.transactionId);
      expect(r.status).toBe(200);
      expect((r.json as { role: unknown; commission: unknown }).role).toBeNull();
      expect(JSON.stringify(r.json)).not.toContain('statementNumber');
      expect((await act(who, id, { action: 'accept' })).status).toBe(404);
      expect((await pdf(who, id)).status).toBe(404);
      const l = (await ledger(who)).json as { asOwner: unknown[]; asAgent: unknown[] };
      expect(l.asOwner).toEqual([]);
      expect(l.asAgent).toEqual([]);
    }
    const agentLedger = (await ledger(agentA)).json as { asAgent: { statementNumber: string }[]; asOwner: unknown[]; agents: unknown[] };
    expect(agentLedger.asAgent.map((c) => c.statementNumber).sort()).toEqual(['COMM-0001', 'COMM-0002']);
    expect(agentLedger.asOwner).toEqual([]);
    expect(agentLedger.agents).toEqual([]); // an agent never sees the brokerage's roster or defaults
  });
});

describe('the agent’s answer', () => {
  it('the owner cannot answer for the agent, and the agent cannot mark it paid', async () => {
    expect((await act(broker, id, { action: 'accept' })).status).toBe(400);
    expect((await act(agentA, id, { action: 'mark_paid' })).status).toBe(400);
    expect((await act(broker, id, { action: 'mark_paid' })).status).toBe(409); // not agreed yet
    expect((await act(agentA, id, { action: 'dance' })).status).toBe(400);
  });

  it('asking for a change needs a note, and a revision starts the agreement over', async () => {
    expect((await act(agentA, id, { action: 'request_change' })).status).toBe(400);
    const asked = await act(agentA, id, { action: 'request_change', note: 'Can the transaction fee come off?' });
    expect(asked.status).toBe(200);
    expect(body(asked).status).toBe('change_requested');
    expect((await act(agentA, id, { action: 'accept' })).status).toBe(409);
    const revised = await propose(broker, { transactionId: dealA.transactionId, gross: 10000, splitType: 'percent', splitValue: 80, deductions: [] });
    expect(revised.status).toBe(200);
    expect(body(revised).status).toBe('proposed');
    expect(body(revised).changeNote).toBeNull();
    expect(body(revised).statementNumber).toBe('COMM-0001');
    expect(body(revised).agentNet).toBe(8000);
  });

  it('agreeing locks it in; revising later needs the agent to agree again', async () => {
    const ok = await act(agentA, id, { action: 'accept' });
    expect(ok.status).toBe(200);
    expect(body(ok).status).toBe('accepted');
    expect((await act(agentA, id, { action: 'accept' })).status).toBe(409);
    const revised = await propose(broker, { transactionId: dealA.transactionId, gross: 10500, splitType: 'percent', splitValue: 80 });
    expect(body(revised).status).toBe('proposed');
    expect((await act(agentA, id, { action: 'accept' })).status).toBe(200);
  });

  it('the agent can say how they want to be paid, and the owner is told', async () => {
    expect((await act(agentA, id, { action: 'set_preference', preference: 'cash' })).status).toBe(400);
    const r = await act(agentA, id, { action: 'set_preference', preference: 'relay' });
    expect(body(r).paymentPreference).toBe('relay');
    expect(((await forDeal(broker, dealA.transactionId)).json as { commission: View }).commission.paymentPreference).toBe('relay');
  });
});

describe('statements and the ledger', () => {
  it('both parties get a PDF', async () => {
    for (const who of [broker, agentA]) {
      const r = await pdf(who, id);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/pdf');
      expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
    }
  });

  it('the owner can download a CSV; an agent cannot', async () => {
    const r = await call(h(GET), broker, { method: 'GET', path: '/api/commissions?format=csv' });
    expect(r.status).toBe(200);
    expect((await call(h(GET), agentA, { method: 'GET', path: '/api/commissions?format=csv' })).status).toBe(404);
    const res = await GET(new NextRequest('http://localhost/api/commissions?format=csv', { headers: { authorization: `Bearer ${broker.token}` } }));
    const csv = await res.text();
    expect(csv).toContain('COMM-0001');
    expect(csv).toContain('10500.00');
    expect(csv).not.toContain(dealB.marker);
  });
});

describe('payment is recorded by the owner', () => {
  it('needs a real date, then it is final', async () => {
    expect((await act(broker, id, { action: 'mark_paid', paidOn: '2999-01-01' })).status).toBe(400);
    const paid = await act(broker, id, { action: 'mark_paid', paidOn: '2026-10-30', note: 'ACH 4471' });
    expect(paid.status).toBe(200);
    expect(body(paid).status).toBe('paid');
    expect((await act(broker, id, { action: 'void' })).status).toBe(409);
    expect((await propose(broker, { transactionId: dealA.transactionId, gross: 9000, splitType: 'percent', splitValue: 70 })).status).toBe(409);
    expect((await act(agentA, id, { action: 'set_preference', preference: 'outside' })).status).toBe(409);
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', agentA.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.some((n) => /marked paid/.test(n.title as string))).toBe(true);
  });
});

describe('when things change', () => {
  it('a voided statement can be proposed again', async () => {
    const second = (await ledger(broker)).json as { asOwner: View[] };
    const c2 = second.asOwner.find((c) => c.statementNumber === 'COMM-0002')!;
    expect((await act(broker, c2.id, { action: 'void' })).status).toBe(200);
    expect((await act(agentA, c2.id, { action: 'accept' })).status).toBe(409);
    expect((await propose(broker, { transactionId: dealA2.transactionId, gross: 7000, splitType: 'percent', splitValue: 75 })).status).toBe(200);
  });

  it('once the agent leaves, they cannot agree to anything new, but the owner can still record payment', async () => {
    const list = (await ledger(broker)).json as { asOwner: View[] };
    const c2 = list.asOwner.find((c) => c.statementNumber === 'COMM-0002')!;
    await admin.from('brokerage_links').update({ status: 'left' }).eq('id', linkId);
    expect((await act(agentA, c2.id, { action: 'accept' })).status).toBe(409);
    expect((await propose(broker, { transactionId: dealA2.transactionId, gross: 8000, splitType: 'percent', splitValue: 75 })).status).toBe(404);
    const view = (await forDeal(broker, dealA2.transactionId)).json as { role: string; canPropose: boolean };
    expect(view.role).toBe('owner');
    expect(view.canPropose).toBe(false);
  });
});
