import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteUserCompletely } from '@/lib/deleteAccount';
import { admin, cleanup, createActor, type Actor } from './helpers';

// Deleting an account removes its brokerage links, private messages and templates, and leaves the other person untouched.

let broker: Actor;
let agent: Actor;

const rows = async (table: string, column: string, id: string) => (await admin.from(table).select('id').eq(column, id)).data ?? [];

beforeAll(async () => {
  broker = await createActor('del-broker', { plan: 'team' });
  agent = await createActor('del-agent', { role: 'agent', agent_workspace: true });
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' });
  await admin.from('brokerage_messages').insert([
    { owner_user_id: broker.id, agent_user_id: agent.id, sender_id: broker.id, body: 'hello' },
    { owner_user_id: broker.id, agent_user_id: agent.id, sender_id: agent.id, body: 'hi' },
  ]);
  await admin.from('doc_templates').insert({ owner_user_id: agent.id, name: 'My template', kind: 'email', body: 'Hello' });
}, 60_000);
afterAll(cleanup);

describe('deleting an account', () => {
  it('an agent’s deletion clears their link, the private thread and their templates, and leaves the broker alone', async () => {
    await deleteUserCompletely(agent.id);
    expect(await rows('brokerage_links', 'agent_user_id', agent.id)).toEqual([]);
    expect(await rows('brokerage_messages', 'agent_user_id', agent.id)).toEqual([]);
    expect(await rows('doc_templates', 'owner_user_id', agent.id)).toEqual([]);
    const { data } = await admin.auth.admin.getUserById(broker.id);
    expect(data.user?.id).toBe(broker.id);
  });

  it('a broker’s deletion clears what they own', async () => {
    const other = await createActor('del-agent2', { role: 'agent', agent_workspace: true });
    await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: other.id, invited_email: other.email, status: 'active' });
    await admin.from('brokerage_messages').insert({ owner_user_id: broker.id, agent_user_id: other.id, sender_id: other.id, body: 'still here' });
    await deleteUserCompletely(broker.id);
    expect(await rows('brokerage_links', 'owner_user_id', broker.id)).toEqual([]);
    expect(await rows('brokerage_messages', 'owner_user_id', broker.id)).toEqual([]);
    const { data } = await admin.auth.admin.getUserById(other.id);
    expect(data.user?.id).toBe(other.id);
  });
});
