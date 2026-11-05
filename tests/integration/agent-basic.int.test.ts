import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as overview, POST as invite } from '@/app/api/oversight/route';
import { GET as myBrokerage } from '@/app/api/brokerage/route';
import { PATCH as answer } from '@/app/api/brokerage/[id]/route';
import { GET as me, PATCH as patchMe } from '@/app/api/auth/me/route';
import { GET as accountSummary } from '@/app/api/account/summary/route';
import { GET as roster } from '@/app/api/oversight/roster/route';
import { GET as listTransactions } from '@/app/api/transactions/route';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/templates/route';
import { PUT as saveStepEmail } from '@/app/api/step-email-templates/route';
import { POST as createChecklistTemplate } from '@/app/api/checklist-templates/route';
import { POST as addRule } from '@/app/api/templates/[id]/rules/route';
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

  it('an agent in the brokerage is told they are in one, so no plan is shown to them; the Account page has no plan or billing either', async () => {
    const mine = await call(h(me), guest, { method: 'GET', path: '/api/auth/me' });
    expect(mine.json).toMatchObject({ inBrokerage: true });
    const summary = await call(h(accountSummary), guest, { method: 'GET', path: '/api/account/summary' });
    expect(summary.json).toMatchObject({ inBrokerage: true, trial: null });
    const own = await call(h(me), proAgent, { method: 'GET', path: '/api/auth/me' });
    expect(own.json).toMatchObject({ inBrokerage: false });
  });

  it('the broker sees each agent\'s base commission terms on the roster, for the Commissions tab', async () => {
    const res = await call(h(roster), broker, { method: 'GET', path: '/api/oversight/roster' });
    const row = (res.json as { agents: { id: string; baseRate: unknown; baseFees: unknown[]; baseCap: unknown }[] }).agents.find((a) => a.id === guest.id);
    expect(row).toBeDefined();
    expect(row).toHaveProperty('baseRate');
    expect(row?.baseFees).toEqual([]);
  });

  it('an agent who has a workspace of their own is Pro and stays Pro', async () => {
    const mine = await call(h(me), proAgent, { method: 'GET', path: '/api/auth/me' });
    expect(mine.json).toMatchObject({ agentWorkspace: true, agentLevel: 'pro' });
  });
});

describe('a lapsed brokerage leaves its agents read-only, not locked out', () => {
  const readOnlyMessage = /read-only/i;

  it('when the owner is no longer on a team plan: they can read and message, and cannot add or change', async () => {
    await setAppMetadata(broker, { plan: 'starter' });
    const mine = await call(h(me), guest, { method: 'GET', path: '/api/auth/me' });
    expect(mine.json).toMatchObject({ agentWorkspace: true, agentLevel: 'basic', readOnly: true });
    expect((await call(h(listTransactions), guest, { method: 'GET', path: '/api/transactions' })).status).toBe(200);
    const blocked = await makeDeal(guest, 'LAPSED');
    expect(blocked.status).toBe(403);
    expect(JSON.stringify(blocked.json)).toMatch(readOnlyMessage);
    await setAppMetadata(broker, { plan: 'team' });
    expect((await makeDeal(guest, 'BACK')).status).toBeLessThan(300);
  });

  it('when the pilot has ended: read-only too, and it ends the moment the broker converts', async () => {
    await admin.from('brokerage_accounts').upsert({ owner_user_id: broker.id, tier: 'pro', status: 'pilot', pilot_started_on: '2026-01-01', pilot_ends_on: '2026-01-31' });
    const ended = await call(h(me), guest, { method: 'GET', path: '/api/auth/me' });
    expect(ended.json).toMatchObject({ readOnly: true });
    expect(JSON.stringify((await makeDeal(guest, 'ENDED')).json)).toMatch(readOnlyMessage);
    await admin.from('brokerage_accounts').update({ status: 'converted' }).eq('owner_user_id', broker.id);
    expect(((await call(h(me), guest, { method: 'GET', path: '/api/auth/me' })).json as { readOnly?: boolean }).readOnly).toBe(false);
    expect((await makeDeal(guest, 'CONVERTED')).status).toBeLessThan(300);
  });

  it('a paused (terminated) account is read-only as well, but the agent can still leave', async () => {
    await admin.from('brokerage_accounts').update({ status: 'terminated' }).eq('owner_user_id', broker.id);
    expect(JSON.stringify((await makeDeal(guest, 'PAUSED')).json)).toMatch(readOnlyMessage);
    expect((await call(h(answer), guest, { method: 'PATCH', path: `/api/brokerage/${linkId}`, params: { id: linkId }, body: { action: 'leave' } })).status).toBe(200);
    await admin.from('brokerage_accounts').delete().eq('owner_user_id', broker.id);
  });

  it('after leaving, access ends but the deals are kept and the Guest access to the coordinator deal remains', async () => {
    expect((await makeDeal(guest, 'LEFT')).status).toBe(403);
    const { data: kept } = await admin.from('transactions').select('id').eq('tc_user_id', guest.id);
    expect((kept ?? []).length).toBe(3);
    const { data: shared } = await admin.from('transaction_agents').select('transaction_id').eq('agent_user_id', guest.id).eq('transaction_id', sharedDeal.transactionId);
    expect((shared ?? []).length).toBe(1);
  });
});

describe('what Agent Basic includes', () => {
  let basic: Actor;
  let basicLink = '';

  beforeAll(async () => {
    basic = await createCollaborator('ab-basic2');
    const sent = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: basic.email } });
    basicLink = (sent.json as { id: string }).id;
    await call(h(answer), basic, { method: 'PATCH', path: `/api/brokerage/${basicLink}`, params: { id: basicLink }, body: { action: 'accept' } });
  }, 30_000);

  it('can use templates, but cannot save their own templates, emails or checklists, or build rules', async () => {
    expect((await call(h(listTemplates), basic, { method: 'GET', path: '/api/templates' })).status).toBe(200);
    const body = { kind: 'email', name: 'Mine', subject: 'Hi', body: 'Hello' };
    for (const res of [
      await call(h(createTemplate), basic, { method: 'POST', path: '/api/templates', body }),
      await call(h(saveStepEmail), basic, { method: 'PUT', path: '/api/step-email-templates', body: { stepName: 'Inspection', subject: 'x', body: 'y' } }),
      await call(h(createChecklistTemplate), basic, { method: 'POST', path: '/api/checklist-templates', body: { name: 'Mine', steps: [] } }),
      await call(h(addRule), basic, { method: 'POST', path: '/api/templates/none/rules', params: { id: '00000000-0000-0000-0000-000000000000' }, body: {} }),
    ]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.json)).toMatch(/Agent Pro/);
    }
  });

  it('cannot turn on the automatic due-date workflow, but can still change their name', async () => {
    const auto = await call(h(patchMe), basic, { method: 'PATCH', path: '/api/auth/me', body: { dueDateWorkflowEnabled: true } });
    expect(auto.status).toBe(403);
    expect(JSON.stringify(auto.json)).toMatch(/Agent Pro/);
    expect((await call(h(patchMe), basic, { method: 'PATCH', path: '/api/auth/me', body: { fullName: 'Basic Agent' } })).status).toBe(200);
  });

  it('an agent with a workspace of their own is not held back by any of this', async () => {
    const res = await call(h(createTemplate), proAgent, { method: 'POST', path: '/api/templates', body: { kind: 'email', name: 'Pro mine', subject: 'Hi', body: 'Hello' } });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    expect((await call(h(patchMe), proAgent, { method: 'PATCH', path: '/api/auth/me', body: { dueDateWorkflowEnabled: false } })).status).toBe(200);
  });
});

describe('inviting someone who has never used Relay', () => {
  it('creates a free agent login for the email, counts as a seat, and sends them to set up their login', async () => {
    const email = `it-new-agent-${Date.now()}@example.test`;
    const sent = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email } });
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    const { data: link } = await admin.from('brokerage_links').select('agent_user_id, status').eq('id', (sent.json as { id: string }).id).single();
    expect(link?.status).toBe('pending');
    const { data: made } = await admin.auth.admin.getUserById(link!.agent_user_id as string);
    expect(made.user?.email).toBe(email);
    expect(made.user?.app_metadata.role).toBe('agent');
    expect(made.user?.app_metadata.agent_workspace).toBeUndefined();
    const { data: mail } = await admin.from('email_outbox').select('body').eq('owner_user_id', broker.id).eq('source', 'brokerage_invite').order('created_at', { ascending: false }).limit(1);
    expect(mail?.[0]?.body).toContain('/agent/login?invited=1');
    // The pending invitation uses a seat.
    const roster = await call(h(overview), broker, { method: 'GET', path: '/api/oversight' });
    expect((roster.json as { totals: { pending: number } }).totals.pending).toBeGreaterThanOrEqual(1);
    await admin.from('brokerage_links').delete().eq('id', (sent.json as { id: string }).id);
    await admin.auth.admin.deleteUser(link!.agent_user_id as string);
  });

  it('refuses an email that belongs to a coordinator account, which must not be turned into an agent', async () => {
    const res = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: tc.email } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.json)).toMatch(/not an agent account/);
  });
});
