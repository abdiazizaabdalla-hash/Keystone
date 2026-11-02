import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listTransactions, DELETE as deleteTransaction } from '@/app/api/transactions/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { GET as listDocuments, PATCH as patchDocument, DELETE as deleteDocument } from '@/app/api/documents/route';
import { GET as listMessages, POST as postMessage } from '@/app/api/messages/route';
import { GET as listTasks, PATCH as patchTask } from '@/app/api/tasks/route';
import { PATCH as patchTaskById } from '@/app/api/tasks/[id]/route';
import { GET as agentDeal } from '@/app/api/agent/transactions/[id]/route';
import { GET as agentDeals } from '@/app/api/agent/transactions/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Isolation across accounts. Two unrelated coordinators must never see or change each
// other's deals, and a free collaborator must only reach the deals they were added to.
// Every "refused" test also checks the data was not touched, and every refusal has a
// matching positive control so a broken test setup cannot pass by accident.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tcA: Actor;
let tcB: Actor;
let collab: Actor;
let dealA: Deal; // owned by A, collaborator added
let dealA2: Deal; // owned by A, collaborator NOT added
let dealB: Deal; // owned by B

const asText = (r: { json: unknown }) => JSON.stringify(r.json ?? '');
const denied = (status: number) => [401, 403, 404].includes(status);

beforeAll(async () => {
  tcA = await createActor('xa-a', { plan: 'pro' });
  tcB = await createActor('xa-b', { plan: 'pro' });
  collab = await createCollaborator('xa-collab');
  dealA = await seedDeal(tcA, 'A1');
  dealA2 = await seedDeal(tcA, 'A2');
  dealB = await seedDeal(tcB, 'B1');
  await addCollaboratorToDeal(dealA, collab, tcA);
});

afterAll(async () => {
  await cleanup();
});

// The same set of attempts, run by a given actor against a given deal.
function attempts(deal: Deal) {
  return {
    readDocuments: () => call(h(listDocuments), actor!, { method: 'GET', path: `/api/documents?transactionId=${deal.transactionId}` }),
    readMessages: () => call(h(listMessages), actor!, { method: 'GET', path: `/api/messages?transactionId=${deal.transactionId}` }),
    agentView: () =>
      call(h(agentDeal), actor!, { method: 'GET', path: `/api/agent/transactions/${deal.transactionId}`, params: { id: deal.transactionId } }),
    readTasks: () => call(h(listTasks), actor!, { method: 'GET', path: `/api/tasks?transactionId=${deal.transactionId}` }),
    postMessage: () =>
      call(h(postMessage), actor!, { method: 'POST', path: '/api/messages', body: { transactionId: deal.transactionId, body: 'injected' } }),
    completeTask: () => call(h(patchTask), actor!, { method: 'PATCH', path: '/api/tasks', body: { taskId: deal.taskId } }),
    setTaskDueDate: () =>
      call(h(patchTaskById), actor!, { method: 'PATCH', path: `/api/tasks/${deal.taskId}`, params: { id: deal.taskId }, body: { dueDate: '2030-01-01' } }),
    editTransaction: () =>
      call(h(patchTransaction), actor!, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body: { status: 'HACKED' } }),
    deleteTransaction: () => call(h(deleteTransaction), actor!, { method: 'DELETE', path: `/api/transactions?id=${deal.transactionId}` }),
    editDocument: () => call(h(patchDocument), actor!, { method: 'PATCH', path: '/api/documents', body: { id: deal.documentId, isSigned: true } }),
    deleteDocument: () => call(h(deleteDocument), actor!, { method: 'DELETE', path: `/api/documents?id=${deal.documentId}` }),
  };
}
let actor: Actor | null = null;

async function dealIsUntouched(deal: Deal) {
  const { data: tx } = await admin.from('transactions').select('id, status').eq('id', deal.transactionId).maybeSingle();
  expect(tx, 'transaction still exists').not.toBeNull();
  expect(tx!.status).not.toBe('HACKED');
  const { data: task } = await admin.from('tasks').select('completed, due_date').eq('id', deal.taskId).maybeSingle();
  expect(task, 'task still exists').not.toBeNull();
  expect(task!.completed).toBeFalsy();
  expect(task!.due_date).toBeNull();
  const { data: doc } = await admin.from('documents').select('is_signed').eq('id', deal.documentId).maybeSingle();
  expect(doc, 'document still exists').not.toBeNull();
  expect(doc!.is_signed).toBe(false);
  const { count } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('transaction_id', deal.transactionId).eq('body', 'injected');
  expect(count).toBe(0);
}

describe('controls: the owner can reach their own deal', () => {
  it('owner A reads documents, messages and tasks on their deal', async () => {
    actor = tcA;
    const a = attempts(dealA);
    for (const r of [await a.readDocuments(), await a.readMessages(), await a.readTasks()]) {
      expect(r.status).toBe(200);
    }
    expect(asText(await a.readMessages())).toContain(dealA.marker);
  });

  it('owner A sees their deals in the list', async () => {
    const res = await call(h(listTransactions), tcA, { method: 'GET', path: '/api/transactions' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).toContain(dealA.marker);
  });
});

describe('an unrelated coordinator cannot reach another coordinator’s deal', () => {
  beforeAll(() => {
    actor = tcB;
  });

  it.each([
    ['read documents', 'readDocuments'],
    ['read messages', 'readMessages'],
    ['read tasks', 'readTasks'],
    ['post a message', 'postMessage'],
    ['complete a task', 'completeTask'],
    ['change a task due date', 'setTaskDueDate'],
    ['edit the transaction', 'editTransaction'],
    ['delete the transaction', 'deleteTransaction'],
    ['edit a document', 'editDocument'],
    ['delete a document', 'deleteDocument'],
  ] as const)('cannot %s', async (_label, key) => {
    actor = tcB;
    const res = await attempts(dealA)[key]();
    expect(denied(res.status), `status was ${res.status}`).toBe(true);
    expect(asText(res)).not.toContain(dealA.marker);
    await dealIsUntouched(dealA);
  });

  it('does not list the other coordinator’s deals', async () => {
    const res = await call(h(listTransactions), tcB, { method: 'GET', path: '/api/transactions' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain(dealA.marker);
    expect(JSON.stringify(res.json)).not.toContain(dealA2.marker);
    expect(JSON.stringify(res.json)).toContain(dealB.marker);
  });
});

describe('a signed-out caller reaches nothing', () => {
  it.each(['readDocuments', 'readMessages', 'readTasks', 'postMessage', 'completeTask', 'editTransaction', 'deleteTransaction'] as const)('%s is 401', async (key) => {
    actor = null;
    const res = await attempts(dealA)[key]();
    expect(res.status).toBe(401);
  });
});

describe('a free collaborator is limited to the deals they were added to', () => {
  it('controls: can read documents, messages and tasks on the deal they were added to', async () => {
    actor = collab;
    const a = attempts(dealA);
    expect((await a.readDocuments()).status).toBe(200);
    expect((await a.readMessages()).status).toBe(200);
    // Collaborators read the checklist through the agent view, not the coordinator tasks list.
    const view = await a.agentView();
    expect(view.status).toBe(200);
    expect(asText(view)).toContain(dealA.marker);
  });

  it('control: can set a due date or "waiting on" on a step of their deal (the agent portal does this on purpose)', async () => {
    actor = collab;
    const res = await attempts(dealA).setTaskDueDate();
    expect(res.status).toBe(200);
    await admin.from('tasks').update({ due_date: null, due_date_spec: null, due_days_after_acceptance: null }).eq('id', dealA.taskId);
  });

  it('their deal list shows only deals they were added to', async () => {
    actor = collab;
    const res = await call(h(agentDeals), collab, { method: 'GET', path: '/api/agent/transactions' });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.json);
    expect(text).toContain(dealA.marker);
    expect(text).not.toContain(dealA2.marker);
    expect(text).not.toContain(dealB.marker);
  });

  it.each([['same coordinator’s other deal', 'A2'], ['another coordinator’s deal', 'B']] as const)('agent view refuses %s', async (_l, which) => {
    actor = collab;
    const res = await attempts(which === 'A2' ? dealA2 : dealB).agentView();
    expect(denied(res.status), `status was ${res.status}`).toBe(true);
    expect(asText(res)).not.toContain(which === 'A2' ? dealA2.marker : dealB.marker);
  });

  it('coordinator task list is not available to a collaborator (they use the agent view)', async () => {
    actor = collab;
    expect(denied((await attempts(dealA).readTasks()).status)).toBe(true);
  });

  it('control: can post a message on their deal', async () => {
    actor = collab;
    const res = await attempts(dealA).postMessage();
    expect(res.status).toBeLessThan(300);
    await admin.from('messages').delete().eq('transaction_id', dealA.transactionId).eq('body', 'injected');
  });

  it('control: can tick a step off on their deal', async () => {
    actor = collab;
    const res = await attempts(dealA).completeTask();
    expect(res.status).toBeLessThan(300);
    await admin.from('tasks').update({ completed: false }).eq('id', dealA.taskId);
  });

  it.each([
    ['read documents', 'readDocuments'],
    ['read messages', 'readMessages'],
    ['read tasks', 'readTasks'],
    ['post a message', 'postMessage'],
    ['complete a task', 'completeTask'],
    ['change a task due date', 'setTaskDueDate'],
    ['edit the transaction', 'editTransaction'],
    ['delete the transaction', 'deleteTransaction'],
    ['edit a document', 'editDocument'],
    ['delete a document', 'deleteDocument'],
  ] as const)('cannot %s on another deal of the same coordinator', async (_label, key) => {
    actor = collab;
    const res = await attempts(dealA2)[key]();
    expect(denied(res.status), `status was ${res.status}`).toBe(true);
    expect(asText(res)).not.toContain(dealA2.marker);
    await dealIsUntouched(dealA2);
  });

  it.each([
    ['read documents', 'readDocuments'],
    ['read messages', 'readMessages'],
    ['read tasks', 'readTasks'],
    ['post a message', 'postMessage'],
    ['complete a task', 'completeTask'],
  ] as const)('cannot %s on another coordinator’s deal', async (_label, key) => {
    actor = collab;
    const res = await attempts(dealB)[key]();
    expect(denied(res.status), `status was ${res.status}`).toBe(true);
    expect(asText(res)).not.toContain(dealB.marker);
    await dealIsUntouched(dealB);
  });

  it.each([
    ['edit the transaction', 'editTransaction'],
    ['delete the transaction', 'deleteTransaction'],
    ['delete a document', 'deleteDocument'],
  ] as const)('cannot %s even on the deal they were added to', async (_label, key) => {
    actor = collab;
    const res = await attempts(dealA)[key]();
    expect(denied(res.status), `status was ${res.status}`).toBe(true);
    await dealIsUntouched(dealA);
  });
});
