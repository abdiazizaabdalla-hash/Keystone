import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listDeals } from '@/app/api/transactions/route';
import { GET as attention } from '@/app/api/dashboard/attention/route';
import { GET as calendar } from '@/app/api/calendar/events/route';
import { addCollaboratorToDeal, admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// Deals other people added a coordinator to: they show in the attention panel and calendar for a paid/in-trial coordinator,
// and in the list (flagged view-only) for one whose trial ended.
type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let owner: Actor;
let paid: Actor;
let lapsed: Actor;
let deal: Deal;
const dueDay = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await createActor('sr-owner', { plan: 'pro' });
  paid = await createActor('sr-paid', { plan: 'pro' });
  lapsed = await createActor('sr-lapsed', { plan: 'starter', trial_ends_at: '2020-01-01T00:00:00Z' });
  deal = await seedDeal(owner, 'SRO');
  await admin.from('tasks').update({ due_date: dueDay, completed: false }).eq('id', deal.taskId);
  await addCollaboratorToDeal(deal, paid, owner);
  await addCollaboratorToDeal(deal, lapsed, owner);
}, 90_000);
afterAll(cleanup);

describe('shared deals in roll-ups', () => {
  it('shows the deal in the paid coordinator’s attention panel with who shared it', async () => {
    const res = await call(h(attention), paid, { method: 'GET', path: '/api/dashboard/attention' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const body = res.json as { dueSoon: { transactionId?: string; label: string; shared?: boolean; tcLabel: string | null }[] };
    const item = body.dueSoon.find((i) => i.label.includes('SRO'));
    expect(item?.shared).toBe(true);
    expect(item?.tcLabel).toBeTruthy();
  });
  it('shows the deal’s dates on the paid coordinator’s calendar', async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const res = await call(h(calendar), paid, { method: 'GET', path: `/api/calendar/events?from=${from}&to=${to}` });
    expect(res.status).toBe(200);
    expect((res.json as { href: string }[]).some((e) => e.href.includes(deal.transactionId))).toBe(true);
  });
  it('lists the deal for a coordinator whose trial ended, flagged view-only, and keeps it out of their roll-ups', async () => {
    const list = await call(h(listDeals), lapsed, { method: 'GET', path: '/api/transactions' });
    const row = (list.json as { id: string; shared?: boolean; limited?: boolean }[]).find((t) => t.id === deal.transactionId);
    expect(row).toMatchObject({ shared: true, limited: true });
    const att = await call(h(attention), lapsed, { method: 'GET', path: '/api/dashboard/attention' });
    expect(JSON.stringify(att.json)).not.toContain('SRO');
  });
  it('does not mark the paid coordinator’s copy as limited', async () => {
    const list = await call(h(listDeals), paid, { method: 'GET', path: '/api/transactions' });
    const row = (list.json as { id: string; shared?: boolean; limited?: boolean }[]).find((t) => t.id === deal.transactionId);
    expect(row?.shared).toBe(true);
    expect(row?.limited).toBeUndefined();
  });
});
