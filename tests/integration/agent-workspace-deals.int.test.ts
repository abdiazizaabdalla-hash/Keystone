import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { GET as listMessages, POST as postMessage } from '@/app/api/messages/route';
import { GET as listTasks, PATCH as patchTask } from '@/app/api/tasks/route';
import { GET as search } from '@/app/api/search/route';
import { GET as dealContacts } from '@/app/api/transactions/[id]/contacts/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Phase 2 step 2b. An agent the admin gave a workspace to is the OWNER of their own deals and an
// invited COLLABORATOR on deals a coordinator added them to. A free agent is only ever the latter.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor;
let tc: Actor;
let ws: Actor; // agent with a workspace
let free: Actor; // free invited agent
let sharedDeal: Deal; // coordinator's deal, both agents were added
let ownDeal: { transactionId: string; taskId: string; agentId: string };
let ownTx: string;

const setTrialEnd = (target: Actor, iso: string | null) =>
  admin.auth.admin.getUserById(target.id).then(({ data }) =>
    admin.auth.admin.updateUserById(target.id, { app_metadata: { ...data.user!.app_metadata, trial_ends_at: iso } })
  );
const refresh = async (a: Actor) => a; // token carries role; server reads app_metadata fresh from the user record

beforeAll(async () => {
  boss = await createActor('d-admin', { is_admin: true });
  tc = await createActor('d-tc', { plan: 'pro' });
  ws = await createCollaborator('d-ws');
  free = await createCollaborator('d-free');
  sharedDeal = await seedDeal(tc, 'SH');
  await addCollaboratorToDeal(sharedDeal, ws, tc);
  await addCollaboratorToDeal(sharedDeal, free, tc);
  const res = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${ws.id}`, params: { id: ws.id }, body: { action: 'set_agent_workspace', enabled: true } });
  expect(res.status).toBe(200);
  await refresh(ws);
  // The workspace agent creates a deal of their own.
  const a = await call(h(createAgent), ws, { method: 'POST', path: '/api/agents', body: { name: 'Own Buyer', email: 'ownbuyer@example.test', flatFee: 0, percentFee: 0 } });
  const agentId = (a.json as { id: string }).id;
  const t = await call(h(createTransaction), ws, { method: 'POST', path: '/api/transactions', body: { agentId, propertyAddress: '5 Own Rd', purchasePrice: 300000, fileNumber: 'OWN-2B' } });
  expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
  const txId = ((t.json as { transaction?: { id: string }; id?: string }).transaction?.id ?? (t.json as { id: string }).id) as string;
  ownTx = txId;
  const { data: task } = await admin.from('tasks').select('id').eq('transaction_id', txId).limit(1).single();
  ownDeal = { transactionId: txId, taskId: task!.id as string, agentId };
});

afterAll(async () => {
  await cleanup();
});

describe('who the app says they are', () => {
  it('the workspace agent gets the full account view; the free agent is told they are a portal login', async () => {
    const mine = await call(h(me), ws, { method: 'GET', path: '/api/auth/me' });
    expect(mine.status).toBe(200);
    expect((mine.json as { isAgent?: boolean }).isAgent).toBeUndefined();
    expect((mine.json as { user?: { agentWorkspace?: boolean } }).user?.agentWorkspace ?? (mine.json as { agentWorkspace?: boolean }).agentWorkspace).toBe(true);

    const theirs = await call(h(me), free, { method: 'GET', path: '/api/auth/me' });
    expect((theirs.json as { isAgent?: boolean }).isAgent).toBe(true);
  });
});

describe('on their own deal the workspace agent is the owner', () => {
  it('can read and tick the checklist through the coordinator routes', async () => {
    expect((await call(h(listTasks), ws, { method: 'GET', path: `/api/tasks?transactionId=${ownTx}` })).status).toBe(200);
    const tick = await call(h(patchTask), ws, { method: 'PATCH', path: '/api/tasks', body: { taskId: ownDeal.taskId } });
    expect(tick.status, JSON.stringify(tick.json)).toBeLessThan(300);
  });

  it('their messages there are posted as the coordinator side, not as an invited agent', async () => {
    const res = await call(h(postMessage), ws, { method: 'POST', path: '/api/messages', body: { transactionId: ownTx, body: 'note to self' } });
    expect(res.status).toBeLessThan(300);
    const { data } = await admin.from('messages').select('sender_role').eq('transaction_id', ownTx).eq('body', 'note to self').single();
    expect(data!.sender_role).toBe('tc');
  });

  it('can list contacts for it and finds it in search', async () => {
    expect((await call(h(dealContacts), ws, { method: 'GET', path: `/api/transactions/${ownTx}/contacts`, params: { id: ownTx } })).status).toBe(200);
    const found = await call(h(search), ws, { method: 'GET', path: '/api/search?q=Own' });
    expect(found.status).toBe(200);
  });

  it('is held to their trial: once it has ended they cannot change their own deal', async () => {
    await setTrialEnd(ws, new Date(Date.now() - 60_000).toISOString());
    const tick = await call(h(patchTask), ws, { method: 'PATCH', path: '/api/tasks', body: { taskId: ownDeal.taskId } });
    expect(tick.status).toBe(402);
    await setTrialEnd(ws, new Date(Date.now() + 20 * 86_400_000).toISOString());
  });
});

describe('on a deal a coordinator added them to, they act as an invited agent', () => {
  it('posts messages as the agent side', async () => {
    const res = await call(h(postMessage), ws, { method: 'POST', path: '/api/messages', body: { transactionId: sharedDeal.transactionId, body: 'from workspace agent' } });
    expect(res.status).toBeLessThan(300);
    const { data } = await admin.from('messages').select('sender_role').eq('transaction_id', sharedDeal.transactionId).eq('body', 'from workspace agent').single();
    expect(data!.sender_role).toBe('agent');
  });

  it('is not held to their trial there (the coordinator is the one with the plan)', async () => {
    await setTrialEnd(ws, new Date(Date.now() - 60_000).toISOString());
    const tick = await call(h(patchTask), ws, { method: 'PATCH', path: '/api/tasks', body: { taskId: sharedDeal.taskId } });
    expect(tick.status, JSON.stringify(tick.json)).toBeLessThan(300);
    await admin.from('tasks').update({ completed: false }).eq('id', sharedDeal.taskId);
    await setTrialEnd(ws, new Date(Date.now() + 20 * 86_400_000).toISOString());
  });

  it('still cannot see or touch the coordinator’s other deals', async () => {
    const other = await seedDeal(tc, 'NOPE');
    expect((await call(h(listMessages), ws, { method: 'GET', path: `/api/messages?transactionId=${other.transactionId}` })).status).toBe(403);
    expect((await call(h(patchTask), ws, { method: 'PATCH', path: '/api/tasks', body: { taskId: other.taskId } })).status).toBe(403);
  });
});

describe('nothing changed for the free agent or the coordinator', () => {
  it('free agent: collaborator on the shared deal, blocked from the workspace agent’s own deal', async () => {
    expect((await call(h(listMessages), free, { method: 'GET', path: `/api/messages?transactionId=${sharedDeal.transactionId}` })).status).toBe(200);
    expect((await call(h(listMessages), free, { method: 'GET', path: `/api/messages?transactionId=${ownTx}` })).status).toBe(403);
    expect((await call(h(patchTask), free, { method: 'PATCH', path: '/api/tasks', body: { taskId: ownDeal.taskId } })).status).toBe(403);
  });

  it('the coordinator cannot reach the workspace agent’s own deal', async () => {
    expect((await call(h(listMessages), tc, { method: 'GET', path: `/api/messages?transactionId=${ownTx}` })).status).toBe(403);
    expect((await call(h(patchTask), tc, { method: 'PATCH', path: '/api/tasks', body: { taskId: ownDeal.taskId } })).status).toBe(403);
  });
});
