import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { GET as listTransactions, DELETE as deleteTransaction } from '@/app/api/transactions/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { GET as listContacts, POST as addContact } from '@/app/api/transactions/[id]/contacts/route';
import { PATCH as patchContact, DELETE as deleteContact } from '@/app/api/transaction-contacts/[id]/route';
import { PATCH as patchTask } from '@/app/api/tasks/route';
import { GET as listMessages, POST as postMessage } from '@/app/api/messages/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// Phase 3a. A paid agent (workspace) sees deals they were added to inside their normal list, edits
// everything on them except deleting the deal, and a free agent still gets only the limited portal.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor;
let tc: Actor;
let paid: Actor;
let free: Actor;
let deal: Deal;

const setTrialEnd = (target: Actor, iso: string | null) =>
  admin.auth.admin.getUserById(target.id).then(({ data }) =>
    admin.auth.admin.updateUserById(target.id, { app_metadata: { ...data.user!.app_metadata, trial_ends_at: iso } })
  );

beforeAll(async () => {
  boss = await createActor('s-admin', { is_admin: true });
  tc = await createActor('s-tc', { plan: 'pro' });
  paid = await createCollaborator('s-paid');
  free = await createCollaborator('s-free');
  deal = await seedDeal(tc, 'SHI');
  await addCollaboratorToDeal(deal, paid, tc);
  await addCollaboratorToDeal(deal, free, tc);
  const res = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${paid.id}`, params: { id: paid.id }, body: { action: 'set_agent_workspace', enabled: true } });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await cleanup();
});

describe('the deal shows up inline', () => {
  it('a paid agent finds it in their normal transaction list, marked shared, without the owner’s fee terms', async () => {
    const res = await call(h(listTransactions), paid, { method: 'GET', path: '/api/transactions' });
    expect(res.status).toBe(200);
    const row = (res.json as Array<Record<string, unknown>>).find((t) => t.id === deal.transactionId);
    expect(row).toBeTruthy();
    expect(row!.shared).toBe(true);
    const agent = row!.shared_agent as Record<string, unknown>;
    expect(agent.name).toContain(deal.marker);
    expect('flat_fee' in agent).toBe(false);
    expect('commission_percent' in agent).toBe(false);
  });

  it('the owner sees it as their own, and a free agent does not get it from this list', async () => {
    const mine = await call(h(listTransactions), tc, { method: 'GET', path: '/api/transactions' });
    expect((mine.json as Array<Record<string, unknown>>).find((t) => t.id === deal.transactionId)!.shared).toBe(false);
    const theirs = await call(h(listTransactions), free, { method: 'GET', path: '/api/transactions' });
    expect(((theirs.json as unknown[]) || []).length).toBe(0);
  });

  it('does not show the coordinator’s other deals', async () => {
    const other = await seedDeal(tc, 'HID');
    const res = await call(h(listTransactions), paid, { method: 'GET', path: '/api/transactions' });
    expect((res.json as Array<Record<string, unknown>>).some((t) => t.id === other.transactionId)).toBe(false);
  });
});

describe('a paid agent edits everything on it except deleting the deal', () => {
  it('changes the status and dates', async () => {
    const res = await call(h(patchTransaction), paid, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body: { closingDate: '2031-01-15' } });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
  });

  it('adds, edits and removes contacts', async () => {
    const add = await call(h(addContact), paid, { method: 'POST', path: '/x', params: { id: deal.transactionId }, body: { role: 'Lender', name: 'Pat Lender', email: 'pat@example.test' } });
    expect(add.status, JSON.stringify(add.json)).toBeLessThan(300);
    const contactId = (add.json as { id?: string; contact?: { id: string } }).id ?? (add.json as { contact?: { id: string } }).contact!.id;
    const edit = await call(h(patchContact), paid, { method: 'PATCH', path: '/x', params: { id: contactId }, body: { name: 'Pat Lender II' } });
    expect(edit.status, JSON.stringify(edit.json)).toBeLessThan(300);
    const del = await call(h(deleteContact), paid, { method: 'DELETE', path: '/x', params: { id: contactId } });
    expect(del.status, JSON.stringify(del.json)).toBeLessThan(300);
    expect((await call(h(listContacts), paid, { method: 'GET', path: '/x', params: { id: deal.transactionId } })).status).toBe(200);
  });

  it('ticks tasks and messages as the agent side', async () => {
    expect((await call(h(patchTask), paid, { method: 'PATCH', path: '/api/tasks', body: { taskId: deal.taskId } })).status).toBeLessThan(300);
    expect((await call(h(postMessage), paid, { method: 'POST', path: '/api/messages', body: { transactionId: deal.transactionId, body: 'paid agent here' } })).status).toBeLessThan(300);
    const { data } = await admin.from('messages').select('sender_role').eq('transaction_id', deal.transactionId).eq('body', 'paid agent here').single();
    expect(data!.sender_role).toBe('agent');
  });

  it('cannot delete the deal; only the owner can', async () => {
    const denied = await call(h(deleteTransaction), paid, { method: 'DELETE', path: `/api/transactions?id=${deal.transactionId}` });
    expect([403, 404]).toContain(denied.status);
    const { data } = await admin.from('transactions').select('id').eq('id', deal.transactionId).maybeSingle();
    expect(data).toBeTruthy();
  });
});

describe('a free agent keeps the limited portal rights', () => {
  it('cannot change the deal dates or edit contacts, but can read the conversation', async () => {
    const edit = await call(h(patchTransaction), free, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body: { closingDate: '2032-02-02' } });
    expect(edit.status).toBe(403);
    const add = await call(h(addContact), free, { method: 'POST', path: '/x', params: { id: deal.transactionId }, body: { role: 'Title', name: 'Free Added' } });
    expect(add.status).toBeLessThan(300);
    const contactId = (add.json as { id?: string; contact?: { id: string } }).id ?? (add.json as { contact?: { id: string } }).contact!.id;
    expect((await call(h(patchContact), free, { method: 'PATCH', path: '/x', params: { id: contactId }, body: { name: 'x' } })).status).toBe(403);
    expect((await call(h(listMessages), free, { method: 'GET', path: `/api/messages?transactionId=${deal.transactionId}` })).status).toBe(200);
  });
});

describe('an unpaid workspace agent falls back to the limited rights', () => {
  it('loses the inline listing and the extra edits when their trial has ended', async () => {
    await setTrialEnd(paid, new Date(Date.now() - 60_000).toISOString());
    const list = await call(h(listTransactions), paid, { method: 'GET', path: '/api/transactions' });
    expect((list.json as Array<Record<string, unknown>>).some((t) => t.id === deal.transactionId)).toBe(false);
    const edit = await call(h(patchTransaction), paid, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body: { closingDate: '2033-03-03' } });
    expect([402, 403]).toContain(edit.status);
    await setTrialEnd(paid, new Date(Date.now() + 20 * 86_400_000).toISOString());
  });
});
