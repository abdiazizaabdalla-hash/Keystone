import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as teamGet } from '@/app/api/team/route';
import { GET as msgGet, POST as msgPost } from '@/app/api/team/messages/route';
import { GET as summaryGet } from '@/app/api/team/messages/summary/route';
import { GET as contactsGet } from '@/app/api/brokerage/contacts/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// An agent who joined a brokerage sees that brokerage's roster, team board and shared contacts through their link, and nothing else.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor;
let coordinator: Actor;
let agentA: Actor; // active in broker's brokerage
let agentB: Actor; // active in another brokerage
let agentPending: Actor; // invited, not accepted
let free: Actor;
let otherBroker: Actor;
let teamId: string;

beforeAll(async () => {
  broker = await createActor('ac-broker', { plan: 'team' });
  otherBroker = await createActor('ac-other', { plan: 'team' });
  coordinator = await createActor('ac-tc', { plan: 'starter' });
  agentA = await createActor('ac-a', { role: 'agent', agent_workspace: true });
  agentB = await createActor('ac-b', { role: 'agent', agent_workspace: true });
  agentPending = await createActor('ac-p', { role: 'agent', agent_workspace: true });
  free = await createCollaborator('ac-free');
  const { data: team } = await admin.from('teams').insert({ owner_id: broker.id, name: 'Acme Realty' }).select('id').single();
  teamId = team!.id;
  await admin.from('team_members').insert([{ team_id: teamId, user_id: broker.id, role: 'owner' }, { team_id: teamId, user_id: coordinator.id, role: 'member' }]);
  const { data: team2 } = await admin.from('teams').insert({ owner_id: otherBroker.id }).select('id').single();
  await admin.from('team_members').insert({ team_id: team2!.id, user_id: otherBroker.id, role: 'owner' });
  await admin.from('brokerage_links').insert([
    { owner_user_id: broker.id, agent_user_id: agentA.id, invited_email: agentA.email, status: 'active' },
    { owner_user_id: otherBroker.id, agent_user_id: agentB.id, invited_email: agentB.email, status: 'active' },
    { owner_user_id: broker.id, agent_user_id: agentPending.id, invited_email: agentPending.email, status: 'pending' },
  ]);
  await admin.from('team_messages').insert({ team_id: teamId, sender_id: broker.id, recipient_id: null, body: 'Office meeting Friday' });
  await admin.from('team_messages').insert({ team_id: teamId, sender_id: broker.id, recipient_id: coordinator.id, body: 'Private to the coordinator' });
  await admin.from('contacts').insert([
    { tc_user_id: coordinator.id, name: 'Shared Lender', email: 'lender@example.com', notes: 'secret note', team_id: teamId, shared_at: new Date().toISOString() },
    { tc_user_id: coordinator.id, name: 'Personal Contact', email: 'mine@example.com' },
  ]);
}, 60_000);
afterAll(cleanup);

const team = (who: Actor | null) => call(h(teamGet), who, { method: 'GET', path: '/api/team' });
const board = (who: Actor | null, thread = 'board') => call(h(msgGet), who, { method: 'GET', path: `/api/team/messages?thread=${thread}` });
const post = (who: Actor | null, thread: string, body: string) => call(h(msgPost), who, { method: 'POST', path: '/api/team/messages', body: { thread, body } });
const contacts = (who: Actor | null) => call(h(contactsGet), who, { method: 'GET', path: '/api/brokerage/contacts' });

describe('an agent in the brokerage', () => {
  it('sees the brokerage roster read-only, with roles', async () => {
    const res = await team(agentA);
    expect(res.status).toBe(200);
    const json = res.json as { team: { name: string }; role: string; viaBrokerage: boolean; members: { userId: string; kind: string; isYou: boolean }[]; pendingInvites: unknown[] };
    expect(json.viaBrokerage).toBe(true);
    expect(json.role).toBe('member');
    expect(json.team.name).toBe('Acme Realty');
    expect(json.pendingInvites).toEqual([]);
    const byId = new Map(json.members.map((m) => [m.userId, m]));
    expect(byId.get(broker.id)?.kind).toBe('broker');
    expect(byId.get(coordinator.id)?.kind).toBe('tc');
    expect(byId.get(agentA.id)).toMatchObject({ kind: 'agent', isYou: true });
    expect(byId.has(agentB.id)).toBe(false);
    expect(byId.has(agentPending.id)).toBe(false);
  });

  it('reads and posts on the team board, and the broker sees the post', async () => {
    const read = await board(agentA);
    expect(read.status).toBe(200);
    expect((read.json as { messages: { body: string }[] }).messages.map((m) => m.body)).toEqual(['Office meeting Friday']);
    const sent = await post(agentA, 'board', 'Open house Saturday');
    expect(sent.status).toBe(201);
    const brokerRead = await board(broker);
    expect((brokerRead.json as { messages: { body: string }[] }).messages.map((m) => m.body)).toContain('Open house Saturday');
  });

  it('cannot open a private team thread with anyone', async () => {
    expect((await board(agentA, coordinator.id)).status).toBe(404);
    expect((await post(agentA, broker.id, 'psst')).status).toBe(404);
  });

  it('gets unread counts for the board', async () => {
    const res = await call(h(summaryGet), agentA, { method: 'GET', path: '/api/team/messages/summary' });
    expect(res.status).toBe(200);
    expect((res.json as { byThread: Record<string, number> }).byThread.board).toBeGreaterThanOrEqual(1);
  });

  it('sees the contacts the brokerage shared (no notes), and not personal ones', async () => {
    const res = await contacts(agentA);
    expect(res.status).toBe(200);
    const rows = res.json as { name: string; notes?: string }[];
    expect(rows.map((r) => r.name)).toEqual(['Shared Lender']);
    expect(rows[0].notes).toBeUndefined();
  });
});

describe('everyone else is kept out', () => {
  it('needs a login', async () => {
    expect((await board(null)).status).toBe(401);
    expect((await contacts(null)).status).toBe(401);
  });

  it('refuses an agent whose invitation is still pending, another brokerage’s agent, and free logins', async () => {
    for (const who of [agentPending, free]) {
      expect((await board(who)).status).toBe(403);
      expect((await contacts(who)).status).toBe(403);
      expect(((await team(who)).json as { team: unknown }).team).toBeNull();
    }
    // agentB belongs to a different brokerage: they never see this one's board.
    const b = await board(agentB);
    expect((b.json as { messages?: { body: string }[] }).messages?.map((m) => m.body) ?? []).not.toContain('Office meeting Friday');
  });

  it('cuts access the moment the agent leaves', async () => {
    await admin.from('brokerage_links').update({ status: 'left' }).eq('owner_user_id', broker.id).eq('agent_user_id', agentA.id);
    expect((await board(agentA)).status).toBe(403);
    expect((await contacts(agentA)).status).toBe(403);
    expect(((await team(agentA)).json as { team: unknown }).team).toBeNull();
  });
});
