import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listContacts, POST as addContact } from '@/app/api/contacts/route';
import { POST as bulk } from '@/app/api/contacts/bulk/route';
import { GET as syncStatus } from '@/app/api/contacts/sync/route';
import { POST as importFromDeals } from '@/app/api/contacts/import-from-deals/route';
import { POST as addDealPerson } from '@/app/api/transactions/[id]/contacts/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// An agent who joined a brokerage shares contacts with the brokerage the same way a coordinator shares with a team: the broker and
// the other agents in it see (and can edit) them, they stay on the agent's account, and nobody outside sees them. People on a deal
// are saved to Contacts as they are added, including those with no email yet.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor;
let agent: Actor;
let colleague: Actor;
let outsider: Actor;
let deal: Deal;
let contactId = '';

const mine = async (who: Actor) => (await call(h(listContacts), who, { method: 'GET', path: '/api/contacts' })).json as { id: string; name: string; email: string | null; is_mine: boolean; team_id: string | null }[];

beforeAll(async () => {
  broker = await createActor('cb-broker', { plan: 'team' });
  agent = await createActor('cb-agent', { role: 'agent', agent_workspace: true });
  colleague = await createActor('cb-colleague', { role: 'agent', agent_workspace: true });
  outsider = await createActor('cb-out', { role: 'agent', agent_workspace: true });
  const { data: team } = await admin.from('teams').insert({ owner_id: broker.id }).select('id').single();
  await admin.from('team_members').insert({ team_id: team!.id, user_id: broker.id, role: 'owner' });
  await admin.from('brokerage_links').insert([
    { owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' },
    { owner_user_id: broker.id, agent_user_id: colleague.id, invited_email: colleague.email, status: 'active' },
  ]);
  deal = await seedDeal(agent, 'CBDEAL');
}, 90_000);
afterAll(cleanup);

describe('people on a deal are saved to Contacts', () => {
  it('saves a person with an email, and a person with only a name', async () => {
    const a = await call(h(addDealPerson), agent, { method: 'POST', path: '/x', params: { id: deal.transactionId }, body: { role: 'Lender', name: 'Lakeview Loans', email: 'lender@cb.example.test' } });
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    const b = await call(h(addDealPerson), agent, { method: 'POST', path: '/x', params: { id: deal.transactionId }, body: { role: 'Buyer', name: 'Dana Buyer' } });
    expect(b.status).toBe(201);
    const names = (await mine(agent)).map((c) => c.name);
    expect(names).toContain('Lakeview Loans');
    expect(names).toContain('Dana Buyer');
  });
  it('“Import from my deals” fills in anyone missed, and is safe to repeat', async () => {
    await admin.from('transaction_contacts').insert({ transaction_id: deal.transactionId, role: 'Title', name: 'Cedar Title', email: 'title@cb.example.test', position: 9 });
    const first = await call(h(importFromDeals), agent, { method: 'POST', path: '/x' });
    expect(first.status).toBe(200);
    expect((await mine(agent)).map((c) => c.email)).toContain('title@cb.example.test');
    expect(((await call(h(importFromDeals), agent, { method: 'POST', path: '/x' })).json as { added: number }).added).toBe(0);
  });
});

describe('sharing with the brokerage', () => {
  it('an agent in a brokerage is offered the shared list, called the brokerage; an outsider is not', async () => {
    expect((await call(h(syncStatus), agent, { method: 'GET', path: '/x' })).json).toMatchObject({ hasTeam: true, teamKind: 'brokerage' });
    expect((await call(h(syncStatus), outsider, { method: 'GET', path: '/x' })).json).toMatchObject({ hasTeam: false });
  });
  it('a shared contact reaches the broker and the other agents, not outsiders', async () => {
    const created = await call(h(addContact), agent, { method: 'POST', path: '/api/contacts', body: { name: 'Preferred Inspector', email: 'inspector@cb.example.test', role: 'Inspector' } });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    contactId = (created.json as { id: string }).id;
    expect((await mine(broker)).some((c) => c.id === contactId)).toBe(false);
    const shared = await call(h(bulk), agent, { method: 'POST', path: '/api/contacts/bulk', body: { ids: [contactId], action: 'share_team' } });
    expect(shared.status, JSON.stringify(shared.json)).toBe(200);
    for (const who of [broker, colleague]) {
      const seen = (await mine(who)).find((c) => c.id === contactId);
      expect(seen, who.email).toBeTruthy();
      expect(seen!.is_mine).toBe(false);
    }
    expect((await mine(outsider)).some((c) => c.id === contactId)).toBe(false);
  });
  it('stopping sharing takes it back off the brokerage list', async () => {
    await call(h(bulk), agent, { method: 'POST', path: '/api/contacts/bulk', body: { ids: [contactId], action: 'unshare_team' } });
    expect((await mine(broker)).some((c) => c.id === contactId)).toBe(false);
    expect((await mine(agent)).some((c) => c.id === contactId)).toBe(true);
  });
});
