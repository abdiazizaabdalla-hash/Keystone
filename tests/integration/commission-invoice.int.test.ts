import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/commissions/route';
import { POST as generate } from '@/app/api/commissions/generate/route';
import { POST as propose } from '@/app/api/commissions/route';
import { PATCH } from '@/app/api/commissions/[id]/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// The agent generates the commission invoice, pre-filled from their brokerage's default split. The brokerage approves it as it is
// (or edits it and the agent agrees again), then records payment.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const gen = (who: Actor | null, body: Record<string, unknown>) => call(h(generate), who, { method: 'POST', path: '/api/commissions/generate', body });
const forDeal = (who: Actor, id: string) => call(h(GET), who, { method: 'GET', path: `/api/commissions?transaction=${id}` });
const act = (who: Actor, id: string, body: Record<string, unknown>) => call(h(PATCH), who, { method: 'PATCH', path: '/x', params: { id }, body });
type View = { id: string; status: string; submitted: boolean; agentNet: number; brokerageNet: number; gross: number };
const v = (r: { json: unknown }) => r.json as View;

let broker: Actor;
let agent: Actor;
let loner: Actor; // an agent in no brokerage
let noSplit: Actor; // in a brokerage that has not set a split
let other: Actor; // a second agent in the first brokerage
let d1: Deal, d2: Deal, d3: Deal, dLoner: Deal, dNoSplit: Deal, dOther: Deal;

beforeAll(async () => {
  broker = await createActor('ci-broker', { plan: 'team' });
  const broker2 = await createActor('ci-broker2', { plan: 'team' });
  agent = await createActor('ci-agent', { role: 'agent', agent_workspace: true });
  loner = await createActor('ci-loner', { role: 'agent', agent_workspace: true });
  noSplit = await createActor('ci-nosplit', { role: 'agent', agent_workspace: true });
  other = await createActor('ci-other', { role: 'agent', agent_workspace: true });
  [d1, d2, d3] = [await seedDeal(agent, 'CI1'), await seedDeal(agent, 'CI2'), await seedDeal(agent, 'CI3')];
  dLoner = await seedDeal(loner, 'CIL');
  dNoSplit = await seedDeal(noSplit, 'CIN');
  dOther = await seedDeal(other, 'CIO');
  for (const o of [broker, broker2]) {
    const { data: team } = await admin.from('teams').insert({ owner_id: o.id }).select('id').single();
    await admin.from('team_members').insert({ team_id: team!.id, user_id: o.id, role: 'owner' });
  }
  await admin.from('brokerage_links').insert([
    { owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', default_split_type: 'percent', default_split_value: 80 },
    { owner_user_id: broker.id, agent_user_id: other.id, invited_email: other.email, status: 'active', default_split_type: 'percent', default_split_value: 70 },
    { owner_user_id: broker2.id, agent_user_id: noSplit.id, invited_email: noSplit.email, status: 'active' },
  ]);
}, 90_000);
afterAll(cleanup);

describe('generating', () => {
  it('needs a login, an agent workspace, their own deal, a brokerage, a split and a real amount', async () => {
    expect((await gen(null, { transactionId: d1.transactionId, gross: 1000 })).status).toBe(401);
    expect((await gen(broker, { transactionId: d1.transactionId, gross: 1000 })).status).toBe(403);
    expect((await gen(agent, { transactionId: dOther.transactionId, gross: 1000 })).status).toBe(404);
    expect((await gen(agent, { gross: 1000 })).status).toBe(400);
    expect((await gen(loner, { transactionId: dLoner.transactionId, gross: 1000 })).status).toBe(409);
    expect((await gen(noSplit, { transactionId: dNoSplit.transactionId, gross: 1000 })).status).toBe(400);
    for (const gross of [0, -5, 'abc', null]) expect((await gen(agent, { transactionId: d1.transactionId, gross })).status).toBe(400);
  });

  it('shows the agent a pre-filled form before, and a statement after', async () => {
    const before = (await forDeal(agent, d1.transactionId)).json as { canGenerate: boolean; defaultSplit: { type: string; value: number }; brokerage: { name: string } };
    expect(before.canGenerate).toBe(true);
    expect(before.defaultSplit).toEqual({ type: 'percent', value: 80 });
    expect(before.brokerage.name).toBeTruthy();
    expect(((await forDeal(loner, dLoner.transactionId)).json as { canGenerate?: boolean }).canGenerate).toBeUndefined();

    const res = await gen(agent, { transactionId: d1.transactionId, gross: 10000 });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(v(res)).toMatchObject({ status: 'change_requested', submitted: true, agentNet: 8000, brokerageNet: 2000 });
    expect((await gen(agent, { transactionId: d1.transactionId, gross: 10000 })).status).toBe(409);
    const after = (await forDeal(agent, d1.transactionId)).json as { role: string; canGenerate?: boolean; commission: View };
    expect(after.role).toBe('agent');
    expect(after.canGenerate).toBeUndefined();
    expect(after.commission.submitted).toBe(true);
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', broker.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.some((b) => /needs your approval/.test(String(b.title)))).toBe(true);
  });
});

describe('approving and paying', () => {
  let id = '';
  it('only the owner can approve, and then the agent’s invoice is agreed', async () => {
    id = (((await forDeal(agent, d1.transactionId)).json as { commission: View }).commission).id;
    expect((await act(agent, id, { action: 'approve' })).status).toBe(400);
    expect((await act(agent, id, { action: 'request_change', note: 'x' })).status).toBe(409);
    expect((await act(other, id, { action: 'approve' })).status).toBe(404);
    const ok = await act(broker, id, { action: 'approve' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(v(ok)).toMatchObject({ status: 'accepted', submitted: false });
    expect((await act(broker, id, { action: 'approve' })).status).toBe(409);
  });

  it('then the owner records the payment', async () => {
    expect(v(await act(broker, id, { action: 'mark_paid' }))).toMatchObject({ status: 'paid' });
  });
});

describe('editing instead', () => {
  it('an edit goes back to the agent to agree, and cannot be approved', async () => {
    const created = v(await gen(agent, { transactionId: d2.transactionId, gross: 9000 }));
    const edited = await call(h(propose), broker, { method: 'POST', path: '/api/commissions', body: { transactionId: d2.transactionId, gross: 9000, splitType: 'percent', splitValue: 75 } });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect(v(edited)).toMatchObject({ status: 'proposed', submitted: false, agentNet: 6750 });
    expect((await act(broker, created.id, { action: 'approve' })).status).toBe(409);
    expect(v(await act(agent, created.id, { action: 'accept' })).status).toBe('accepted');
  });

  it('a real change request (with a note) is not an invoice waiting for approval', async () => {
    const p = await call(h(propose), broker, { method: 'POST', path: '/api/commissions', body: { transactionId: d3.transactionId, gross: 5000, splitType: 'percent', splitValue: 80 } });
    const pid = v(p).id;
    const asked = await act(agent, pid, { action: 'request_change', note: 'Please make it 85%' });
    expect(v(asked)).toMatchObject({ status: 'change_requested', submitted: false });
    expect((await act(broker, pid, { action: 'approve' })).status).toBe(409);
  });
});
