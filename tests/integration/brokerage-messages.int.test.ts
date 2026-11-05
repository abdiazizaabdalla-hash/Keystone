import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/brokerage-messages/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Private messages between a brokerage owner and one of their agents. Only those two people can read or write a thread.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const get = (who: Actor | null, query = '') => call(h(GET), who, { method: 'GET', path: `/api/brokerage-messages${query}` });
const send = (who: Actor | null, to: string, body: unknown) => call(h(POST), who, { method: 'POST', path: '/api/brokerage-messages', body: { with: to, body } });

let broker: Actor;
let otherBroker: Actor;
let teammate: Actor; // on the broker's team, not an agent of theirs
let agentA: Actor;
let agentB: Actor; // belongs to the other brokerage
let agentC: Actor; // not in any brokerage
let free: Actor;

const link = (owner: Actor, agent: Actor, status = 'active') => admin.from('brokerage_links').insert({ owner_user_id: owner.id, agent_user_id: agent.id, invited_email: agent.email, status }).select('id').single();

beforeAll(async () => {
  broker = await createActor('bm-broker', { plan: 'team' });
  otherBroker = await createActor('bm-other', { plan: 'brokerage' });
  teammate = await createActor('bm-mate', { plan: 'starter' });
  agentA = await createActor('bm-a', { role: 'agent', agent_workspace: true });
  agentB = await createActor('bm-b', { role: 'agent', agent_workspace: true });
  agentC = await createActor('bm-c', { role: 'agent', agent_workspace: true });
  free = await createCollaborator('bm-free');
  const { data: team } = await admin.from('teams').insert({ owner_id: broker.id }).select('id').single();
  await admin.from('team_members').insert([{ team_id: team!.id, user_id: broker.id, role: 'owner' }, { team_id: team!.id, user_id: teammate.id, role: 'member' }]);
  await link(broker, agentA);
  await link(otherBroker, agentB);
}, 60_000);
afterAll(cleanup);

const bodies = (json: unknown) => ((json as { messages: { body: string }[] }).messages ?? []).map((m) => m.body);

describe('access', () => {
  it('is off (404) when the brokerage feature is off', async () => {
    const saved = process.env.RELAY_FEATURES;
    process.env.RELAY_FEATURES = 'agent_workspace,templates';
    try {
      expect((await get(broker)).status).toBe(404);
      expect((await send(broker, agentA.id, 'hi')).status).toBe(404);
    } finally {
      process.env.RELAY_FEATURES = saved;
    }
  });

  it('needs a login', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await send(null, agentA.id, 'hi')).status).toBe(401);
  });

  it('refuses people who are not linked to each other', async () => {
    for (const [who, to] of [
      [broker, agentB.id], // another brokerage's agent
      [broker, agentC.id], // no brokerage
      [broker, teammate.id], // a teammate is not an agent
      [teammate, agentA.id], // a team member cannot message the broker's agent
      [agentA, otherBroker.id], // an agent cannot message a brokerage they did not join
      [agentA, agentB.id],
      [free, agentA.id],
      [free, broker.id],
      [broker, broker.id],
    ] as [Actor, string][]) {
      expect((await send(who, to, 'hello')).status).toBe(404);
      expect((await get(who, `?with=${to}`)).status).toBe(404);
    }
  });

  it('lists only your own partners', async () => {
    const mine = (await get(broker)).json as { conversations: { id: string }[] };
    expect(mine.conversations.map((c) => c.id)).toEqual([agentA.id]);
    expect(((await get(teammate)).json as { conversations: unknown[] }).conversations).toEqual([]);
    expect(((await get(agentC)).json as { conversations: unknown[] }).conversations).toEqual([]);
    expect(((await get(free)).json as { conversations: unknown[] }).conversations).toEqual([]);
  });
});

describe('a conversation', () => {
  it('checks what is sent', async () => {
    expect((await send(broker, agentA.id, '   ')).status).toBe(400);
    expect((await send(broker, agentA.id, 'x'.repeat(4001))).status).toBe(400);
    expect((await send(broker, '', 'hi')).status).toBe(400);
  });

  it('shows the same thread to both sides, with unread counts that clear when read', async () => {
    expect((await send(broker, agentA.id, 'Welcome aboard')).status).toBe(201);
    expect((await send(broker, agentA.id, 'Send me your June numbers')).status).toBe(201);

    const agentList = (await get(agentA)).json as { unread: number; conversations: { id: string; role: string; unread: number }[] };
    expect(agentList.unread).toBe(2);
    expect(agentList.conversations).toHaveLength(1);
    expect(agentList.conversations[0]).toMatchObject({ id: broker.id, role: 'owner', unread: 2 });
    // The sender has nothing unread from their own messages.
    expect(((await get(broker)).json as { unread: number }).unread).toBe(0);

    const read = await get(agentA, `?with=${broker.id}`);
    expect(bodies(read.json)).toEqual(['Welcome aboard', 'Send me your June numbers']);
    expect(((await get(agentA)).json as { unread: number }).unread).toBe(0);

    expect((await send(agentA, broker.id, 'Will do')).status).toBe(201);
    const ownerList = (await get(broker)).json as { unread: number; conversations: { lastMessage: { fromMe: boolean; body: string } }[] };
    expect(ownerList.unread).toBe(1);
    expect(ownerList.conversations[0].lastMessage).toMatchObject({ fromMe: false, body: 'Will do' });
    expect(bodies((await get(broker, `?with=${agentA.id}`)).json)).toEqual(['Welcome aboard', 'Send me your June numbers', 'Will do']);
    expect(((await get(broker)).json as { unread: number }).unread).toBe(0);
  });

  it('nobody else can read it, even by guessing ids', async () => {
    for (const who of [teammate, otherBroker, agentB, agentC, free]) {
      expect((await get(who, `?with=${agentA.id}`)).status).toBe(404);
      expect((await get(who, `?with=${broker.id}`)).status).toBe(404);
    }
    const { data } = await admin.from('brokerage_messages').select('body').or(`owner_user_id.eq.${otherBroker.id},agent_user_id.eq.${agentB.id}`);
    expect(data).toEqual([]);
  });

  it('rings the bell once for a burst, and not for the sender', async () => {
    const rows = async (user: Actor) => (await admin.from('notifications').select('title, link, event_type').eq('recipient_user_id', user.id).eq('event_type', 'brokerage_message')).data ?? [];
    // Two broker messages were sent before the agent read them: one notification. The agent's reply made one for the broker.
    const forAgent = await rows(agentA);
    expect(forAgent).toHaveLength(1);
    expect(forAgent[0].link).toBe('/dashboard/messages');
    const forBroker = await rows(broker);
    expect(forBroker).toHaveLength(1);
    expect(forBroker[0].link).toBe('/dashboard/collaborate#messages');
  });
});

describe('when the link ends or the plan lapses', () => {
  it('keeps the history but closes the conversation', async () => {
    await admin.from('brokerage_links').update({ status: 'left' }).eq('owner_user_id', broker.id).eq('agent_user_id', agentA.id);
    expect((await send(agentA, broker.id, 'one more')).status).toBe(404);
    expect((await get(broker, `?with=${agentA.id}`)).status).toBe(404);
    expect(((await get(broker)).json as { conversations: unknown[] }).conversations).toEqual([]);
    const { data } = await admin.from('brokerage_messages').select('id').eq('owner_user_id', broker.id).eq('agent_user_id', agentA.id);
    expect(data?.length).toBe(3);
  });

  it('closes when the owner drops off the Team plan', async () => {
    await admin.from('brokerage_links').update({ status: 'active' }).eq('owner_user_id', broker.id).eq('agent_user_id', agentA.id);
    expect((await send(broker, agentA.id, 'back again')).status).toBe(201);
    await admin.auth.admin.updateUserById(broker.id, { app_metadata: { plan: 'starter' } });
    expect((await send(agentA, broker.id, 'still there?')).status).toBe(404);
    expect((await get(broker, `?with=${agentA.id}`)).status).toBe(404);
  });
});
