import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/templates/route';
import { GET as getTemplate, PATCH as patchTemplate, DELETE as deleteTemplate } from '@/app/api/templates/[id]/route';
import { POST as renderTemplate } from '@/app/api/templates/[id]/render/route';
import { GET as getTeam } from '@/app/api/team/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// A brokerage owner shares a template (for example the brokerage's IABS). Agents who joined the brokerage and team members
// get it pinned and usable; nobody else does; nobody but the owner can change it. The People roster tags each role.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor;
let otherBroker: Actor;
let agent: Actor; // joined the brokerage
let outsider: Actor; // agent in no brokerage
let tc: Actor; // coordinator on the broker's team
let agentDeal: Deal;
let sharedId = '';
let privateId = '';

const list = async (who: Actor, qs = '') => (await call(h(listTemplates), who, { method: 'GET', path: `/api/templates${qs}` })).json as { id: string; from_brokerage?: boolean; shared_by?: string }[];

beforeAll(async () => {
  broker = await createActor('bt-broker', { plan: 'team' });
  otherBroker = await createActor('bt-other', { plan: 'team' });
  agent = await createActor('bt-agent', { role: 'agent', agent_workspace: true });
  outsider = await createActor('bt-out', { role: 'agent', agent_workspace: true });
  tc = await createActor('bt-tc', { plan: 'team' });
  agentDeal = await seedDeal(agent, 'BT');
  const { data: team } = await admin.from('teams').insert({ owner_id: broker.id }).select('id').single();
  await admin.from('team_members').insert([{ team_id: team!.id, user_id: broker.id, role: 'owner' }, { team_id: team!.id, user_id: tc.id, role: 'member' }]);
}, 60_000);
afterAll(cleanup);

describe('sharing a template', () => {
  it('only a brokerage owner can mark one as shared', async () => {
    expect((await call(h(createTemplate), agent, { method: 'POST', path: '/api/templates', body: { kind: 'letter', name: 'Mine', body: 'Hi', brokerageShared: true } })).status).toBe(403);
    const own = await call(h(createTemplate), agent, { method: 'POST', path: '/api/templates', body: { kind: 'letter', name: 'Agent own', body: 'Hi' } });
    expect(own.status).toBe(201);
    const priv = await call(h(createTemplate), broker, { method: 'POST', path: '/api/templates', body: { kind: 'letter', name: 'Broker private', body: 'Private' } });
    privateId = (priv.json as { id: string }).id;
    const res = await call(h(createTemplate), broker, { method: 'POST', path: '/api/templates', body: { kind: 'letter', name: 'Brokerage IABS notice', body: 'Dear {{client_name}}, about {{property_address}}', brokerageShared: true } });
    expect(res.status).toBe(201);
    sharedId = (res.json as { id: string }).id;
  });

  it('nobody sees it before they belong to the brokerage', async () => {
    for (const who of [agent, outsider, tc, otherBroker]) {
      if (who === tc) continue; // the coordinator is already on the team, covered below
      expect((await list(who)).some((t) => t.id === sharedId)).toBe(false);
    }
    expect((await call(h(renderTemplate), agent, { method: 'POST', path: '/x', params: { id: sharedId }, body: { transactionId: agentDeal.transactionId } })).status).toBe(404);
  });
});

describe('who gets it', () => {
  it('an agent who joined sees it marked, and can fill it in on their deal', async () => {
    await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', responded_at: new Date().toISOString() });
    const rows = await list(agent);
    const shared = rows.find((t) => t.id === sharedId);
    expect(shared?.from_brokerage).toBe(true);
    expect(shared?.shared_by).toBeTruthy();
    expect(rows.some((t) => t.id === privateId)).toBe(false);
    const filled = await call(h(renderTemplate), agent, { method: 'POST', path: '/x', params: { id: sharedId }, body: { transactionId: agentDeal.transactionId } });
    expect(filled.status).toBe(200);
    expect((filled.json as { body: string }).body).toContain(agentDeal.marker);
  });

  it('a coordinator on the team sees it too, and state filters still apply', async () => {
    expect((await list(tc)).some((t) => t.id === sharedId)).toBe(true);
    await call(h(patchTemplate), broker, { method: 'PATCH', path: '/x', params: { id: sharedId }, body: { states: ['CO'] } });
    expect((await list(agent, '?state=TX')).some((t) => t.id === sharedId)).toBe(false);
    expect((await list(agent, '?state=CO')).some((t) => t.id === sharedId)).toBe(true);
    await call(h(patchTemplate), broker, { method: 'PATCH', path: '/x', params: { id: sharedId }, body: { states: [] } });
  });

  it('people outside the brokerage never see it', async () => {
    expect((await list(outsider)).some((t) => t.id === sharedId)).toBe(false);
    expect((await list(otherBroker)).some((t) => t.id === sharedId)).toBe(false);
    expect((await call(h(getTemplate), outsider, { method: 'GET', path: '/x', params: { id: sharedId } })).status).toBe(404);
  });

  it('members can use it but never change or delete it', async () => {
    expect((await call(h(getTemplate), agent, { method: 'GET', path: '/x', params: { id: sharedId } })).status).toBe(200);
    expect((await call(h(patchTemplate), agent, { method: 'PATCH', path: '/x', params: { id: sharedId }, body: { name: 'Hacked' } })).status).toBe(404);
    expect((await call(h(deleteTemplate), agent, { method: 'DELETE', path: '/x', params: { id: sharedId } })).status).toBe(404);
    expect((await admin.from('doc_templates').select('name').eq('id', sharedId).single()).data?.name).toBe('Brokerage IABS notice');
  });

  it('stopping sharing, or the feature being off, takes it away', async () => {
    const saved = process.env.RELAY_FEATURES;
    process.env.RELAY_FEATURES = 'agent_workspace,templates';
    try {
      expect((await list(agent)).some((t) => t.id === sharedId)).toBe(false);
    } finally {
      process.env.RELAY_FEATURES = saved;
    }
    expect((await call(h(patchTemplate), broker, { method: 'PATCH', path: '/x', params: { id: sharedId }, body: { brokerageShared: false } })).status).toBe(200);
    expect((await list(agent)).some((t) => t.id === sharedId)).toBe(false);
    expect((await call(h(renderTemplate), agent, { method: 'POST', path: '/x', params: { id: sharedId }, body: { transactionId: agentDeal.transactionId } })).status).toBe(404);
    await call(h(patchTemplate), broker, { method: 'PATCH', path: '/x', params: { id: sharedId }, body: { brokerageShared: true } });
    expect((await list(agent)).some((t) => t.id === sharedId)).toBe(true);
  });

  it('a lapsed owner plan switches sharing off', async () => {
    await admin.auth.admin.updateUserById(broker.id, { app_metadata: { plan: 'starter' } });
    expect((await list(agent)).some((t) => t.id === sharedId)).toBe(false);
    await admin.auth.admin.updateUserById(broker.id, { app_metadata: { plan: 'team' } });
  });
});

describe('the People roster', () => {
  it('tags the broker, coordinators and agents, and lists joined agents', async () => {
    const res = await call(h(getTeam), broker, { method: 'GET', path: '/api/team' });
    expect(res.status).toBe(200);
    const body = res.json as { members: { userId: string; kind: string }[]; brokerageAgents: { userId: string | null; status: string }[] };
    expect(body.members.find((m) => m.userId === broker.id)?.kind).toBe('broker');
    expect(body.members.find((m) => m.userId === tc.id)?.kind).toBe('tc');
    expect(body.brokerageAgents.find((a) => a.userId === agent.id)?.status).toBe('active');
  });

  it('an agent in a team shows as an agent', async () => {
    const { data: m } = await admin.from('team_members').select('team_id').eq('user_id', broker.id).single();
    await admin.from('team_members').insert({ team_id: m!.team_id, user_id: outsider.id, role: 'member' });
    const body = (await call(h(getTeam), broker, { method: 'GET', path: '/api/team' })).json as { members: { userId: string; kind: string }[] };
    expect(body.members.find((x) => x.userId === outsider.id)?.kind).toBe('agent');
  });
});
