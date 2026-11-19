import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/commissions/route';
import { admin, addCollaboratorToDeal, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// A coordinator runs the deal and adds an agent who is in a brokerage. The commission is still between that agent and their brokerage.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const forDeal = (who: Actor, id: string) => call(h(GET), who, { method: 'GET', path: `/api/commissions?transaction=${id}` });

let coordinator: Actor, broker: Actor, agent: Actor, stranger: Actor;
let deal: Deal;

beforeAll(async () => {
  coordinator = await createActor('cp-tc', { plan: 'pro' });
  broker = await createActor('cp-broker', { plan: 'team' });
  agent = await createActor('cp-agent', { role: 'agent', agent_workspace: true });
  stranger = await createActor('cp-stranger', { role: 'agent', agent_workspace: true });
  deal = await seedDeal(coordinator, 'CP1');
  await admin.from('transactions').update({ status: 'Closed', purchase_price: 560000 }).eq('id', deal.transactionId);
  const { data: team } = await admin.from('teams').insert({ owner_id: broker.id }).select('id').single();
  await admin.from('team_members').insert({ team_id: team!.id, user_id: broker.id, role: 'owner' });
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', default_split_type: 'percent', default_split_value: 80, default_commission_type: 'percent', default_commission_value: 3 });
  await addCollaboratorToDeal(deal, agent, coordinator);
}, 90_000);
afterAll(cleanup);

describe('commission on a deal a coordinator runs', () => {
  it('shows the participant agent their commission estimate', async () => {
    const res = await forDeal(agent, deal.transactionId);
    const body = res.json as { role: string; commission: { status: string } | null };
    expect(body.role).toBe('agent');
    expect(body.commission?.status).toBe('estimate');
  });
  it('lets the brokerage confirm it', async () => {
    const owner = (await forDeal(broker, deal.transactionId)).json as { role: string; canPropose: boolean };
    expect(owner.role).toBe('owner');
    expect(owner.canPropose).toBe(true);
    const res = await call(h(POST), broker, { method: 'POST', path: '/api/commissions', body: { transactionId: deal.transactionId, gross: 16800 } });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    const after = (await forDeal(agent, deal.transactionId)).json as { commission: { status: string } };
    expect(after.commission.status).toBe('proposed');
  });
  it('shows nothing to others', async () => {
    expect((await forDeal(stranger, deal.transactionId)).json).toMatchObject({ role: null });
    expect((await forDeal(coordinator, deal.transactionId)).json).toMatchObject({ role: null });
  });
});
