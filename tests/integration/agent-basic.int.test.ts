import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as overview, POST as invite } from '@/app/api/oversight/route';
import { GET as myBrokerage } from '@/app/api/brokerage/route';
import { PATCH as answer } from '@/app/api/brokerage/[id]/route';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Agent Basic. A free agent login (Guest) who accepts a brokerage's invitation gets a free workspace to run their own deals, for as
// long as they are on that brokerage's roster. Nothing is stored on the agent: the access is worked out on every request.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor;
let tc: Actor;
let guest: Actor;
let proAgent: Actor;
let sharedDeal: Deal;
let linkId = '';

const setAppMetadata = async (target: Actor, changes: Record<string, unknown>) => {
  const { data } = await admin.auth.admin.getUserById(target.id);
  await admin.auth.admin.updateUserById(target.id, { app_metadata: { ...data.user!.app_metadata, ...changes } });
};
const makeDeal = async (who: Actor, file: string) => {
  const a = await call(h(createAgent), who, { method: 'POST', path: '/api/agents', body: { name: `Buyer ${file}`, email: `${file.toLowerCase()}@example.test`, flatFee: 0, percentFee: 0 } });
  if (a.status >= 300) return a;
  return call(h(createTransaction), who, { method: 'POST', path: '/api/transactions', body: { agentId: (a.json as { id: string }).id, propertyAddress: `${file} Basic Rd`, purchasePrice: 300000, fileNumber: file } });
};

beforeAll(async () => {
  broker = await createActor('ab-broker', { plan: 'team' });
  tc = await createActor('ab-tc', { plan: 'pro' });
  guest = await createCollaborator('ab-guest');
  proAgent = await createActor('ab-pro', { role: 'agent', agent_workspace: true });
  sharedDeal = await seedDeal(tc, 'ABS');
  await addCollaboratorToDeal(sharedDeal, guest, tc);
  // The Starter trial has run out for this login. Basic must not depend on it.
  await setAppMetadata(guest, { trial_ends_at: '2020-01-01T00:00:00Z' });
}, 60_000);
afterAll(cleanup);

describe('as a Guest (invited by a coordinator)', () => {
  it('works on the deal they were added to but cannot create or run their own', async () => {
    const mine = await call(h(me), guest, { method: 'GET', path: '/api/auth/me' });
    expect((mine.json as { isAgent?: boolean }).isAgent).toBe(true);
    expect((await call(h(createAgent), guest, { method: 'POST', path: '/api/agents', body: { name: 'X', email: 'x@example.test', flatFee: 0, percentFee: 0 } })).status).toBe(403);
    expect((await makeDeal(guest, 'GUESTDEAL')).status).toBe(403);
  });

  it('a coordinator, who is not an agent, cannot answer a brokerage invitation', async () => {
    expect((await call(h(myBrokerage), tc, { method: 'GET', path: '/api/brokerage' })).status).toBe(403);
  });
});

describe('accepting a brokerage invitation', () => {
  it('the broker invites the Guest, who sees it and is told it will provide a workspace once they join', async () => {
    const sent = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: guest.email } });
    expect(sent.status).toBe(201);
    linkId = (sent.json as { id: string }).id;
    const theirs = await call(h(myBrokerage), guest, { method: 'GET', path: '/api/brokerage' });
    expect(theirs.status).toBe(200);
    const body = theirs.json as { invites: { id: string }[]; current: unknown; providesWorkspace: boolean };
    expect(body.invites.map((i) => i.id)).toEqual([linkId]);
    expect(body.current).toBeNull();
    expect(body.providesWorkspace).toBe(false);
  });

  it('still cannot run their own deals until they accept', async () => {
    expect((await makeDeal(guest, 'BEFORE')).status).toBe(403);
  });

  it('accepting gives them a Basic workspace, even though their Starter trial is long over', async () => {
    expect((await call(h(answer), guest, { method: 'PATCH', path: `/api/brokerage/${linkId}`, params: { id: linkId }, body: { action: 'accept' } })).status).toBe(200);
    const mine = await call(h(me), guest, { method: 'GET', path: '/api/auth/me' });
    expect((mine.json as { isAgent?: boolean }).isAgent).toBeUndefined();
    expect(mine.json).toMatchObject({ agentWorkspace: true, agentLevel: 'basic' });
    expect((mine.json as { trial?: unknown }).trial ?? null).toBeNull();
    const made = await makeDeal(guest, 'BASIC1');
    expect(made.status, JSON.stringify(made.json)).toBeLessThan(300);
  });

  it('nothing was written onto the agent: the grant is not in their stored account', async () => {
    const { data } = await admin.auth.admin.getUserById(guest.id);
    expect(data.user!.app_metadata.agent_workspace).toBeUndefined();
    expect(data.user!.app_metadata.agent_access_source).toBeUndefined();
  });

  it('the broker sees the deal the Basic agent created', async () => {
    const roster = await call(h(overview), broker, { method: 'GET', path: '/api/oversight' });
    const row = (roster.json as { agents: { userId: string | null; production: { activeDeals: number } }[] }).agents.find((a) => a.userId === guest.id);
    expect(row?.production.activeDeals).toBe(1);
  });

  it('an agent who has a workspace of their own is Pro and stays Pro', async () => {
    const mine = await call(h(me), proAgent, { method: 'GET', path: '/api/auth/me' });
    expect(mine.json).toMatchObject({ agentWorkspace: true, agentLevel: 'pro' });
  });
});

describe('Basic lasts only while the brokerage has them', () => {
  it('ends when the owner is no longer on a team plan, and returns when they are', async () => {
    await setAppMetadata(broker, { plan: 'starter' });
    expect((await makeDeal(guest, 'LAPSED')).status).toBe(403);
    expect(((await call(h(me), guest, { method: 'GET', path: '/api/auth/me' })).json as { isAgent?: boolean }).isAgent).toBe(true);
    await setAppMetadata(broker, { plan: 'team' });
    expect((await makeDeal(guest, 'BACK')).status).toBeLessThan(300);
  });

  it('ends when the agent leaves, but the deals are kept and the Guest access to the coordinator deal remains', async () => {
    expect((await call(h(answer), guest, { method: 'PATCH', path: `/api/brokerage/${linkId}`, params: { id: linkId }, body: { action: 'leave' } })).status).toBe(200);
    expect((await makeDeal(guest, 'LEFT')).status).toBe(403);
    const { data: kept } = await admin.from('transactions').select('id').eq('tc_user_id', guest.id);
    expect((kept ?? []).length).toBe(2);
    const { data: shared } = await admin.from('transaction_agents').select('transaction_id').eq('agent_user_id', guest.id).eq('transaction_id', sharedDeal.transactionId);
    expect((shared ?? []).length).toBe(1);
  });
});
