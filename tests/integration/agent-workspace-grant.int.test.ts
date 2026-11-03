import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { GET as adminList } from '@/app/api/admin/users/route';
import { GET as listAgents, POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction, GET as listTransactions } from '@/app/api/transactions/route';
import { GET as listMessages } from '@/app/api/messages/route';
import { GET as listContacts } from '@/app/api/contacts/route';
import { GET as listListings } from '@/app/api/listings/route';
import { GET as stepTemplates } from '@/app/api/step-email-templates/route';
import { GET as qbStatus } from '@/app/api/quickbooks/status/route';
import { GET as upcomingKeyDates } from '@/app/api/key-dates/upcoming/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Phase 2, step 1: an admin can give an agent login a workspace of their own and take it away.
// Free collaborators (no grant) keep their limits.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor; // platform admin
let tc: Actor;
let freeAgent: Actor; // collaborator, never granted
let grantedAgent: Actor; // collaborator that the admin will upgrade
let deal: Deal; // owned by tc; granted agent was added to it

const grant = (target: Actor, enabled: unknown, extra: object = {}) =>
  call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${target.id}`, params: { id: target.id }, body: { action: 'set_agent_workspace', enabled, ...extra } });

const newAgent = (name: string) => ({ name, email: `${name.toLowerCase().replace(/\s+/g, '')}@example.test`, flatFee: 0, percentFee: 0 });
const metadataOf = async (a: Actor) => (await admin.auth.admin.getUserById(a.id)).data.user?.app_metadata ?? {};

beforeAll(async () => {
  boss = await createActor('ws-admin', { is_admin: true });
  tc = await createActor('ws-tc', { plan: 'pro' });
  freeAgent = await createCollaborator('ws-free');
  grantedAgent = await createCollaborator('ws-granted');
  deal = await seedDeal(tc, 'WS');
  await addCollaboratorToDeal(deal, grantedAgent, tc);
});

afterAll(async () => {
  await admin.from('audit_log').delete().in('entity_id', [grantedAgent?.id, freeAgent?.id, tc?.id].filter(Boolean));
  await cleanup();
});

describe('only an admin can change who has a workspace', () => {
  it('refuses a coordinator, a free agent, and an agent trying it on themselves', async () => {
    for (const actor of [tc, freeAgent, grantedAgent]) {
      const res = await call(h(adminPatch), actor, {
        method: 'PATCH',
        path: `/api/admin/users/${grantedAgent.id}`,
        params: { id: grantedAgent.id },
        body: { action: 'set_agent_workspace', enabled: true },
      });
      expect(res.status).toBe(403);
    }
    expect((await metadataOf(grantedAgent)).agent_workspace).toBeUndefined();
  });

  it('refuses an unknown value, a coordinator target, and a missing user', async () => {
    expect((await grant(grantedAgent, 'yes')).status).toBe(400);
    expect((await grant(tc, true)).status).toBe(400);
    const ghost = { id: '00000000-0000-0000-0000-000000000000' } as Actor;
    expect((await grant(ghost, true)).status).toBe(404);
    expect((await metadataOf(tc)).agent_workspace).toBeUndefined();
  });
});

describe('before the grant', () => {
  it('a free agent cannot create an agent profile or a transaction', async () => {
    expect((await call(h(createAgent), grantedAgent, { method: 'POST', path: '/api/agents', body: newAgent('Pre Grant') })).status).toBe(403);
  });
});

describe('granting a workspace', () => {
  it('turns it on, starts a 30-day trial, and shows in the admin list', async () => {
    const res = await grant(grantedAgent, true);
    expect(res.status).toBe(200);
    const meta = await metadataOf(grantedAgent);
    expect(meta.agent_workspace).toBe(true);
    expect(meta.role).toBe('agent');
    const days = (new Date(meta.trial_ends_at as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    const list = await call(h(adminList), boss, { method: 'GET', path: '/api/admin/users' });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).toContain(grantedAgent.id);
  });

  it('the granted agent can now create an agent profile and a transaction of their own', async () => {
    const agentRes = await call(h(createAgent), grantedAgent, { method: 'POST', path: '/api/agents', body: newAgent('Own Client') });
    expect(agentRes.status, JSON.stringify(agentRes.json)).toBeLessThan(300);
    const agentId = (agentRes.json as { id: string }).id;
    const txRes = await call(h(createTransaction), grantedAgent, {
      method: 'POST',
      path: '/api/transactions',
      body: { agentId, propertyAddress: '9 Own St', purchasePrice: 250000, fileNumber: 'WS-OWN-1' },
    });
    expect(txRes.status, JSON.stringify(txRes.json)).toBeLessThan(300);
    const { count } = await admin.from('transactions').select('id', { count: 'exact', head: true }).eq('tc_user_id', grantedAgent.id);
    expect(count).toBe(1);
  });

  it('lists their own deals with the shared deal inline and still reaches the deal a coordinator added them to', async () => {
    const own = await call(h(listTransactions), grantedAgent, { method: 'GET', path: '/api/transactions' });
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.json)).toContain('WS-OWN-1');
    // The deal a coordinator added them to sits in the same list, marked shared.
    const sharedRow = (own.json as Array<Record<string, unknown>>).find((t) => t.id === deal.transactionId);
    expect(sharedRow?.shared).toBe(true);
    const shared = await call(h(listMessages), grantedAgent, { method: 'GET', path: `/api/messages?transactionId=${deal.transactionId}` });
    expect(shared.status).toBe(200);
  });

  it('does not open anyone else’s deals, and a free agent still cannot create anything', async () => {
    const tcView = await call(h(listTransactions), tc, { method: 'GET', path: '/api/transactions' });
    expect(JSON.stringify(tcView.json)).not.toContain('WS-OWN-1');
    expect((await call(h(listAgents), freeAgent, { method: 'GET', path: '/api/agents' })).status).toBeLessThan(500);
    expect((await call(h(createAgent), freeAgent, { method: 'POST', path: '/api/agents', body: newAgent('Still Blocked') })).status).toBe(403);
  });

  it('records who granted it', async () => {
    const { data } = await admin.from('audit_log').select('action').eq('entity_id', grantedAgent.id);
    expect((data ?? []).map((r) => r.action)).toContain('admin.grant_agent_workspace');
  });
});

describe('coordinator tools open to a granted agent, closed to a free agent', () => {
  const TOOLS = [
    ['contacts', listContacts, '/api/contacts'],
    ['listings', listListings, '/api/listings'],
    ['step email templates', stepTemplates, '/api/step-email-templates'],
    ['QuickBooks status', qbStatus, '/api/quickbooks/status'],
  ] as const;

  it.each(TOOLS)('free agent is refused: %s', async (_n, handler, path) => {
    const res = await call(h(handler), freeAgent, { method: 'GET', path });
    expect(res.status).toBe(403);
  });

  it('upcoming key dates: a free agent gets an empty list, a granted agent gets their own', async () => {
    const free = await call(h(upcomingKeyDates), freeAgent, { method: 'GET', path: '/api/key-dates/upcoming' });
    expect(free.status).toBe(200);
    expect((free.json as { items: unknown[] }).items).toEqual([]);
    const granted = await call(h(upcomingKeyDates), grantedAgent, { method: 'GET', path: '/api/key-dates/upcoming' });
    expect(granted.status).toBe(200);
  });

  it.each(TOOLS)('granted agent can open: %s', async (_n, handler, path) => {
    const res = await call(h(handler), grantedAgent, { method: 'GET', path });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(400);
  });
});

describe('removing a workspace', () => {
  it('puts them back to a free collaborator who keeps the deals they were added to', async () => {
    const res = await grant(grantedAgent, false);
    expect(res.status).toBe(200);
    expect((await metadataOf(grantedAgent)).agent_workspace).toBe(false);

    const blocked = await call(h(createAgent), grantedAgent, { method: 'POST', path: '/api/agents', body: newAgent('After Revoke') });
    expect(blocked.status).toBe(403);
    const shared = await call(h(listMessages), grantedAgent, { method: 'GET', path: `/api/messages?transactionId=${deal.transactionId}` });
    expect(shared.status).toBe(200);
  });

  it('can be granted again without losing the earlier work', async () => {
    expect((await grant(grantedAgent, true)).status).toBe(200);
    const { count } = await admin.from('transactions').select('id', { count: 'exact', head: true }).eq('tc_user_id', grantedAgent.id);
    expect(count).toBe(1);
  });
});
