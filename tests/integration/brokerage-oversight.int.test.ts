import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as overview, POST as invite } from '@/app/api/oversight/route';
import { DELETE as removeLink } from '@/app/api/oversight/[id]/route';
import { GET as dealList } from '@/app/api/oversight/deals/route';
import { GET as dealDetail } from '@/app/api/oversight/deals/[id]/route';
import { GET as myBrokerage } from '@/app/api/brokerage/route';
import { PATCH as answer } from '@/app/api/brokerage/[id]/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { PATCH as toggleTask } from '@/app/api/tasks/route';
import { notifyDeal } from '@/lib/notifications';
import { admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Brokerage oversight. A brokerage owner sees and edits the deals of agents who accepted an invitation, and nobody else's.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor;
let otherBroker: Actor;
let agentA: Actor; // invited, accepts
let agentB: Actor; // never invited
let agentC: Actor; // has a deal the broker must never reach
let free: Actor; // free agent login
let dealA: Deal;
let dealC: Deal;
let linkId = '';

const stageOf = async (transactionId: string) => (await admin.from('transactions').select('status').eq('id', transactionId).single()).data?.status;
const notificationsFor = async (user: Actor) => (await admin.from('notifications').select('*').eq('recipient_user_id', user.id)).data ?? [];

beforeAll(async () => {
  broker = await createActor('bk-broker', { plan: 'team' });
  otherBroker = await createActor('bk-other', { plan: 'brokerage' });
  agentA = await createActor('bk-a', { role: 'agent', agent_workspace: true });
  agentB = await createActor('bk-b', { role: 'agent', agent_workspace: true });
  agentC = await createActor('bk-c', { role: 'agent', agent_workspace: true });
  free = await createCollaborator('bk-free');
  dealA = await seedDeal(agentA, 'BKA');
  dealC = await seedDeal(agentC, 'BKC');
}, 60_000);
afterAll(cleanup);

describe('who may use it', () => {
  it('answers 404 when the feature is off', async () => {
    const saved = process.env.RELAY_FEATURES;
    process.env.RELAY_FEATURES = 'agent_workspace,templates';
    try {
      expect((await call(h(overview), broker, { method: 'GET', path: '/api/oversight' })).status).toBe(404);
      expect((await call(h(myBrokerage), agentA, { method: 'GET', path: '/api/brokerage' })).status).toBe(404);
    } finally {
      process.env.RELAY_FEATURES = saved;
    }
  });

  it('is for Team and Brokerage owners; agents and free logins are refused', async () => {
    expect((await call(h(invite), agentA, { method: 'POST', path: '/api/oversight', body: { email: 'x@example.test' } })).status).toBe(403);
    expect((await call(h(overview), free, { method: 'GET', path: '/api/oversight' })).status).toBe(403);
    expect((await call(h(myBrokerage), broker, { method: 'GET', path: '/api/brokerage' })).status).toBe(403);
    expect((await call(h(myBrokerage), free, { method: 'GET', path: '/api/brokerage' })).status).toBe(403);
    expect((await call(h(overview), null, { method: 'GET', path: '/api/oversight' })).status).toBe(401);
  });
});

describe('before the agent accepts', () => {
  it('rejects bad and duplicate invitations', async () => {
    expect((await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: 'nope' } })).status).toBe(400);
    expect((await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: broker.email } })).status).toBe(400);
    const sent = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: agentA.email } });
    expect(sent.status).toBe(201);
    linkId = (sent.json as { id: string }).id;
    expect((await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: agentA.email.toUpperCase() } })).status).toBe(409);
  });

  it('the invitation was written to the outbox, not sent', async () => {
    const { data } = await admin.from('email_outbox').select('to_emails, source').eq('owner_user_id', broker.id).eq('source', 'brokerage_invite');
    expect(data?.some((r) => (r.to_emails as string[]).includes(agentA.email))).toBe(true);
  });

  it('shows the owner nothing of the agent', async () => {
    expect((await call(h(dealList), broker, { method: 'GET', path: '/api/oversight/deals' })).json).toEqual([]);
    expect((await call(h(dealDetail), broker, { method: 'GET', path: '/x', params: { id: dealA.transactionId } })).status).toBe(404);
    expect((await call(h(patchTransaction), broker, { method: 'PATCH', path: `/api/transactions/x?id=${dealA.transactionId}`, body: { status: 'Closed' } })).status).toBe(403);
    expect((await call(h(toggleTask), broker, { method: 'PATCH', path: '/api/tasks', body: { taskId: dealA.taskId } })).status).toBe(403);
    expect(await stageOf(dealA.transactionId)).not.toBe('Closed');
  });

  it('only the invited agent sees and can answer it', async () => {
    const mine = (await call(h(myBrokerage), agentA, { method: 'GET', path: '/api/brokerage' })).json as { invites: { id: string }[]; current: unknown; terms: { private: string[] } };
    expect(mine.invites.map((i) => i.id)).toEqual([linkId]);
    expect(mine.current).toBeNull();
    expect(mine.terms.private.join(' ')).toMatch(/messages/);
    expect(((await call(h(myBrokerage), agentB, { method: 'GET', path: '/api/brokerage' })).json as { invites: unknown[] }).invites).toEqual([]);
    expect((await call(h(answer), agentB, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'accept' } })).status).toBe(404);
    expect((await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'dance' } })).status).toBe(400);
  });
});

describe('after the agent accepts', () => {
  it('accepting joins, and tells the owner', async () => {
    expect((await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'accept' } })).status).toBe(200);
    const rows = await notificationsFor(broker);
    expect(rows.some((n) => n.event_type === 'brokerage' && /joined/.test(n.title as string))).toBe(true);
    const mine = (await call(h(myBrokerage), agentA, { method: 'GET', path: '/api/brokerage' })).json as { current: { id: string } | null };
    expect(mine.current?.id).toBe(linkId);
  });

  it('the owner sees that agent’s deals and numbers, and no one else’s', async () => {
    const ov = (await call(h(overview), broker, { method: 'GET', path: '/api/oversight' })).json as { agents: { status: string; production: { activeDeals: number } }[]; totals: { agents: number } };
    expect(ov.totals.agents).toBe(1);
    expect(ov.agents[0].status).toBe('active');
    expect(ov.agents[0].production.activeDeals).toBe(1);
    const deals = (await call(h(dealList), broker, { method: 'GET', path: '/api/oversight/deals' })).json as { id: string }[];
    expect(deals.map((d) => d.id)).toEqual([dealA.transactionId]);
    expect((await call(h(dealDetail), broker, { method: 'GET', path: '/x', params: { id: dealC.transactionId } })).status).toBe(404);
    expect((await call(h(dealDetail), otherBroker, { method: 'GET', path: '/x', params: { id: dealA.transactionId } })).status).toBe(404);
  });

  it('the detail shows the deal and checklist but not messages or file contents', async () => {
    const res = await call(h(dealDetail), broker, { method: 'GET', path: '/x', params: { id: dealA.transactionId } });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.json);
    expect(text).toContain(dealA.marker);
    expect(text).not.toContain(`Message ${dealA.marker}`);
    expect(text).not.toContain('storage_path');
    expect((res.json as { tasks: unknown[]; documents: unknown[] }).tasks.length).toBe(1);
    expect((res.json as { documents: unknown[] }).documents.length).toBe(1);
  });

  it('the owner can edit that agent’s deal and tick its steps, and no other deal', async () => {
    expect((await call(h(patchTransaction), broker, { method: 'PATCH', path: `/api/transactions/x?id=${dealA.transactionId}`, body: { status: 'Inspection & Repairs' } })).status).toBe(200);
    expect(await stageOf(dealA.transactionId)).toBe('Inspection & Repairs');
    expect((await call(h(toggleTask), broker, { method: 'PATCH', path: '/api/tasks', body: { taskId: dealA.taskId } })).status).toBe(200);
    expect((await admin.from('tasks').select('completed').eq('id', dealA.taskId).single()).data?.completed).toBe(true);
    expect((await call(h(patchTransaction), broker, { method: 'PATCH', path: `/api/transactions/x?id=${dealC.transactionId}`, body: { status: 'Closed' } })).status).toBe(403);
    expect((await call(h(toggleTask), broker, { method: 'PATCH', path: '/api/tasks', body: { taskId: dealC.taskId } })).status).toBe(403);
    expect((await call(h(patchTransaction), otherBroker, { method: 'PATCH', path: `/api/transactions/x?id=${dealA.transactionId}`, body: { status: 'Closed' } })).status).toBe(403);
    expect(await stageOf(dealC.transactionId)).not.toBe('Closed');
  });

  it('edits by the owner are written to the audit log', async () => {
    const { data } = await admin.from('audit_log').select('action, entity_id').eq('actor_id', broker.id).eq('action', 'brokerage.deal_edit');
    expect(data?.some((r) => r.entity_id === dealA.transactionId)).toBe(true);
  });

  it('the owner hears about updates on the deal, but never private messages', async () => {
    const before = (await notificationsFor(broker)).length;
    await notifyDeal({ transactionId: dealA.transactionId, actorUserId: agentA.id, type: 'task_completed', title: 'Step completed' });
    await notifyDeal({ transactionId: dealA.transactionId, actorUserId: agentA.id, type: 'message', title: 'New message', body: 'private words' });
    const rows = await notificationsFor(broker);
    expect(rows.length).toBe(before + 1);
    const added = rows.find((n) => n.event_type === 'task_completed');
    expect(added?.link).toBe(`/dashboard/collaborate/deals/${dealA.transactionId}`);
    expect(rows.some((n) => n.body === 'private words')).toBe(false);
    // Someone else's deal never reaches this owner.
    await notifyDeal({ transactionId: dealC.transactionId, actorUserId: agentC.id, type: 'task_completed', title: 'Step completed' });
    expect((await notificationsFor(broker)).length).toBe(before + 1);
  });

  it('an agent can be in only one brokerage at a time', async () => {
    const second = await call(h(invite), otherBroker, { method: 'POST', path: '/api/oversight', body: { email: agentA.email } });
    expect(second.status).toBe(201);
    const secondId = (second.json as { id: string }).id;
    expect((await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id: secondId }, body: { action: 'accept' } })).status).toBe(409);
    expect((await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id: secondId }, body: { action: 'decline' } })).status).toBe(200);
  });
});

describe('leaving and removing', () => {
  it('the owner cannot remove someone else’s agent', async () => {
    expect((await call(h(removeLink), otherBroker, { method: 'DELETE', path: '/x', params: { id: linkId } })).status).toBe(404);
  });

  it('when the agent leaves, access ends at once, and a new invitation is possible', async () => {
    expect((await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'leave' } })).status).toBe(200);
    expect((await call(h(dealList), broker, { method: 'GET', path: '/api/oversight/deals' })).json).toEqual([]);
    expect((await call(h(dealDetail), broker, { method: 'GET', path: '/x', params: { id: dealA.transactionId } })).status).toBe(404);
    expect((await call(h(toggleTask), broker, { method: 'PATCH', path: '/api/tasks', body: { taskId: dealA.taskId } })).status).toBe(403);
    const again = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: agentA.email } });
    expect(again.status).toBe(201);
    linkId = (again.json as { id: string }).id;
  });

  it('declining ends the invitation; the owner can cancel an open one', async () => {
    expect((await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'accept' } })).status).toBe(200);
    expect((await call(h(removeLink), broker, { method: 'DELETE', path: '/x', params: { id: linkId } })).status).toBe(200);
    expect((await call(h(dealList), broker, { method: 'GET', path: '/api/oversight/deals' })).json).toEqual([]);
    expect(((await call(h(myBrokerage), agentA, { method: 'GET', path: '/api/brokerage' })).json as { current: unknown }).current).toBeNull();
    const fresh = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: agentB.email } });
    expect(fresh.status).toBe(201);
    expect((await call(h(removeLink), broker, { method: 'DELETE', path: '/x', params: { id: (fresh.json as { id: string }).id } })).status).toBe(200);
    expect(((await call(h(myBrokerage), agentB, { method: 'GET', path: '/api/brokerage' })).json as { invites: unknown[] }).invites).toEqual([]);
  });

  it('a lapsed owner plan switches access off without deleting anything', async () => {
    const inv = await call(h(invite), broker, { method: 'POST', path: '/api/oversight', body: { email: agentA.email } });
    const id = (inv.json as { id: string }).id;
    expect(inv.status, JSON.stringify(inv.json)).toBe(201);
    const acc = await call(h(answer), agentA, { method: 'PATCH', path: '/x', params: { id }, body: { action: 'accept' } });
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    // (ticking the deal's only step closed it, so look at all deals, not just open ones)
    expect(((await call(h(dealList), broker, { method: 'GET', path: '/api/oversight/deals?show=all' })).json as unknown[]).length).toBe(1);
    await admin.auth.admin.updateUserById(broker.id, { app_metadata: { plan: 'starter' } });
    expect((await call(h(dealList), broker, { method: 'GET', path: '/api/oversight/deals' })).status).toBe(403);
    expect((await call(h(toggleTask), broker, { method: 'PATCH', path: '/api/tasks', body: { taskId: dealA.taskId } })).status).toBe(403);
    const before = (await notificationsFor(broker)).length;
    await notifyDeal({ transactionId: dealA.transactionId, actorUserId: agentA.id, type: 'stage_changed', title: 'Stage changed' });
    expect((await notificationsFor(broker)).length).toBe(before);
  });
});
