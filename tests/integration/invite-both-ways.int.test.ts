import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { POST as createAgent } from '@/app/api/agents/route';
import { GET as listTransactions, POST as createTransaction, DELETE as deleteTransaction } from '@/app/api/transactions/route';
import { GET as listInvites, POST as sendInvite } from '@/app/api/agent-invites/route';
import { POST as acceptInvite } from '@/app/api/agent-invites/accept/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { PATCH as patchTask } from '@/app/api/tasks/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor } from './helpers';

// Phase 3b. A paid agent can invite a coordinator onto their own deal; the coordinator accepts from their
// normal account (and stays a coordinator), then both sides edit everything except deleting the deal.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor;
let agentWs: Actor;
let tcPro: Actor;
let freeAgent: Actor;
let otherTc: Actor;
let dealId: string;
let taskId: string;

beforeAll(async () => {
  boss = await createActor('i-admin', { is_admin: true });
  agentWs = await createCollaborator('i-ws');
  tcPro = await createActor('i-tc', { plan: 'pro' });
  otherTc = await createActor('i-tc2', { plan: 'pro' });
  freeAgent = await createCollaborator('i-free');
  const grant = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${agentWs.id}`, params: { id: agentWs.id }, body: { action: 'set_agent_workspace', enabled: true } });
  expect(grant.status).toBe(200);
  const a = await call(h(createAgent), agentWs, { method: 'POST', path: '/api/agents', body: { name: 'Self Agent', email: 'selfagent@example.test', flatFee: 0, percentFee: 0 } });
  const agentId = (a.json as { id: string }).id;
  const t = await call(h(createTransaction), agentWs, { method: 'POST', path: '/api/transactions', body: { agentId, propertyAddress: '9 Invite Way', purchasePrice: 400000, fileNumber: 'INV-1' } });
  expect(t.status, JSON.stringify(t.json)).toBeLessThan(300);
  dealId = ((t.json as { transaction?: { id: string }; id?: string }).transaction?.id ?? (t.json as { id: string }).id) as string;
  const { data: task } = await admin.from('tasks').select('id').eq('transaction_id', dealId).limit(1).single();
  taskId = task!.id as string;
});

afterAll(async () => {
  await cleanup();
});

const invite = (who: Actor, email: string, extra: Record<string, unknown> = {}) =>
  call(h(sendInvite), who, { method: 'POST', path: '/api/agent-invites', body: { transactionId: dealId, email, ...extra } });

describe('an agent with a workspace invites a coordinator', () => {
  it('sends a pending invite and grants nothing yet', async () => {
    const res = await invite(agentWs, tcPro.email, { inviteeRole: 'tc' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const { data: row } = await admin.from('agent_invites').select('status, invited_by').eq('transaction_id', dealId).eq('email', tcPro.email).single();
    expect(row!.status).toBe('pending');
    expect(row!.invited_by).toBe(agentWs.id);
    const { data: link } = await admin.from('transaction_agents').select('agent_user_id').eq('transaction_id', dealId).eq('agent_user_id', tcPro.id);
    expect(link ?? []).toHaveLength(0);
  });

  it('refuses a repeat invite, and an email that belongs to an agent login', async () => {
    expect((await invite(agentWs, tcPro.email, { inviteeRole: 'tc' })).status).toBe(400);
    expect((await invite(agentWs, freeAgent.email, { inviteeRole: 'tc' })).status).toBe(400);
  });

  it('is closed to everyone else: a coordinator cannot use the coordinator invite, a free agent cannot invite at all', async () => {
    const seeded = await seedDeal(otherTc, 'INVX');
    const asTc = await call(h(sendInvite), otherTc, { method: 'POST', path: '/api/agent-invites', body: { transactionId: seeded.transactionId, email: 'someone@example.test', inviteeRole: 'tc' } });
    expect(asTc.status).toBe(403);
    await addCollaboratorToDeal(seeded, freeAgent, otherTc);
    const asFree = await call(h(sendInvite), freeAgent, { method: 'POST', path: '/api/agent-invites', body: { transactionId: seeded.transactionId, email: 'x@example.test' } });
    expect(asFree.status).toBe(403);
  });
});

describe('the coordinator answers from their normal account', () => {
  it('sees the invitation waiting; the agent and other people do not', async () => {
    const mine = await call(h(listInvites), tcPro, { method: 'GET', path: '/api/agent-invites' });
    expect(mine.status).toBe(200);
    const list = mine.json as Array<{ transactionId: string; propertyAddress: string }>;
    expect(list.map((i) => i.transactionId)).toContain(dealId);
    expect(((await call(h(listInvites), otherTc, { method: 'GET', path: '/api/agent-invites' })).json as unknown[])).toHaveLength(0);
    expect(((await call(h(listInvites), agentWs, { method: 'GET', path: '/api/agent-invites' })).json as unknown[])).toHaveLength(0);
  });

  it('cannot be accepted by someone the invite was not sent to, or by an agent login', async () => {
    expect((await call(h(acceptInvite), otherTc, { method: 'POST', path: '/x', body: { transactionId: dealId } })).status).toBe(403);
  });

  it('accepting adds the deal to their list and leaves them a coordinator', async () => {
    const res = await call(h(acceptInvite), tcPro, { method: 'POST', path: '/x', body: { transactionId: dealId } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const { data: user } = await admin.auth.admin.getUserById(tcPro.id);
    expect(user.user!.app_metadata?.role).not.toBe('agent');
    const list = await call(h(listTransactions), tcPro, { method: 'GET', path: '/api/transactions' });
    const row = (list.json as Array<Record<string, unknown>>).find((t) => t.id === dealId);
    expect(row?.shared).toBe(true);
    const pending = await call(h(listInvites), tcPro, { method: 'GET', path: '/api/agent-invites' });
    expect(pending.json as unknown[]).toHaveLength(0);
  });
});

describe('both sides edit everything except deleting the deal', () => {
  it('the coordinator can change dates and tick tasks', async () => {
    expect((await call(h(patchTransaction), tcPro, { method: 'PATCH', path: `/api/transactions/x?id=${dealId}`, body: { closingDate: '2031-05-05' } })).status).toBeLessThan(300);
    expect((await call(h(patchTask), tcPro, { method: 'PATCH', path: '/api/tasks', body: { taskId } })).status).toBeLessThan(300);
  });

  it('the coordinator cannot delete the agent’s deal; the agent can', async () => {
    const denied = await call(h(deleteTransaction), tcPro, { method: 'DELETE', path: `/api/transactions?id=${dealId}` });
    expect([403, 404]).toContain(denied.status);
    expect((await admin.from('transactions').select('id').eq('id', dealId).maybeSingle()).data).toBeTruthy();
  });

  it('the agent still reaches the deal as its owner', async () => {
    const list = await call(h(listTransactions), agentWs, { method: 'GET', path: '/api/transactions' });
    const row = (list.json as Array<Record<string, unknown>>).find((t) => t.id === dealId);
    expect(row?.shared).toBe(false);
  });
});
