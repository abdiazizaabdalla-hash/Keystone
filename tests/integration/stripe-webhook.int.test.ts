import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { admin, cleanup, createActor, type Actor } from './helpers';

// Stripe delivers events more than once, late, and out of order. The webhook is the only
// place a plan is granted or taken away, so it must give the same answer however many times
// it is replayed, and a stale event must never hand back a plan that has been cancelled.
// Stripe itself is replaced with a fake; the database is relay-test.

const stripeFake = vi.hoisted(() => ({
  subscriptionStatus: 'active' as string,
}));

vi.mock('@/lib/stripe', () => ({
  STRIPE_PRICE_IDS: { starter: 'p1', pro: 'p2', team: 'p3', brokerage: 'p4' },
  stripe: {
    webhooks: {
      constructEvent: (raw: string, signature: string) => {
        if (signature !== 'valid-signature') throw new Error('bad signature');
        return JSON.parse(raw);
      },
    },
    subscriptions: {
      retrieve: async () => ({ status: stripeFake.subscriptionStatus }),
      list: async () => ({ data: [] }),
      cancel: async () => ({}),
    },
  },
}));

vi.mock('@/lib/refundSuspend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/refundSuspend')>()),
  latestChargeFullyRefunded: async () => null,
}));

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integrationtestsecret';

// Imported after the mocks above are registered.
const { POST: webhook } = await import('@/app/api/stripe/webhook/route');
const { NextRequest } = await import('next/server');

let eventCounter = 0;
async function send(event: object, signature = 'valid-signature') {
  const request = new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: JSON.stringify({ id: `evt_${++eventCounter}`, ...event }),
  });
  return webhook(request);
}

const checkoutCompleted = (userId: string, plan: string, customer: string, sub: string) => ({
  type: 'checkout.session.completed',
  data: { object: { mode: 'subscription', client_reference_id: userId, metadata: { plan, user_id: userId }, customer, subscription: sub } },
});
const subscriptionEvent = (type: string, customer: string, sub: string, status: string) => ({
  type,
  data: { object: { id: sub, customer, status, items: { data: [{ current_period_end: 1893456000 }] } } },
});

async function planOf(user: Actor) {
  const { data } = await admin.auth.admin.getUserById(user.id);
  return data.user?.app_metadata?.plan as string | undefined;
}
const customerRows = async (user: Actor) =>
  (await admin.from('stripe_customers').select('*').eq('user_id', user.id)).data ?? [];
const teamsOwnedBy = async (user: Actor) => (await admin.from('teams').select('id').eq('owner_id', user.id)).data ?? [];

let payer: Actor;
let n = 0;
const ids = () => ({ customer: `cus_it_${Date.now()}_${++n}`, sub: `sub_it_${Date.now()}_${n}` });

beforeAll(async () => {
  payer = await createActor('stripe-payer');
});
beforeEach(() => {
  stripeFake.subscriptionStatus = 'active';
});
afterAll(async () => {
  const users = [payer].filter(Boolean);
  for (const u of users) {
    const { data: teams } = await admin.from('teams').select('id').eq('owner_id', u.id);
    for (const t of teams ?? []) await admin.from('team_members').delete().eq('team_id', t.id);
    await admin.from('teams').delete().eq('owner_id', u.id);
    await admin.from('stripe_customers').delete().eq('user_id', u.id);
  }
  await cleanup();
});

describe('Stripe webhook: replays and ordering', () => {
  it('rejects a bad signature and changes nothing', async () => {
    const { customer, sub } = ids();
    const res = await send(checkoutCompleted(payer.id, 'pro', customer, sub), 'forged');
    expect(res.status).toBe(400);
    expect(await planOf(payer)).toBeUndefined();
    expect(await customerRows(payer)).toHaveLength(0);
  });

  it('rejects an unsigned call', async () => {
    const request = new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' });
    expect((await webhook(request)).status).toBe(500);
  });

  it('grants the plan once, and a replayed checkout event changes nothing further', async () => {
    const { customer, sub } = ids();
    const event = checkoutCompleted(payer.id, 'team', customer, sub);
    expect((await send(event)).status).toBe(200);
    const first = { plan: await planOf(payer), rows: await customerRows(payer), teams: await teamsOwnedBy(payer) };
    expect(first.plan).toBe('team');
    expect(first.rows).toHaveLength(1);
    expect(first.teams).toHaveLength(1);

    for (let i = 0; i < 3; i++) expect((await send(event)).status).toBe(200);
    expect(await planOf(payer)).toBe('team');
    expect(await customerRows(payer)).toHaveLength(1);
    expect(await teamsOwnedBy(payer)).toHaveLength(1);
  });

  it('cancels once, and a replayed cancellation still leaves them on Starter', async () => {
    const [row] = await customerRows(payer);
    const cancel = subscriptionEvent('customer.subscription.deleted', row.stripe_customer_id as string, row.stripe_subscription_id as string, 'canceled');
    for (let i = 0; i < 3; i++) expect((await send(cancel)).status).toBe(200);
    expect(await planOf(payer)).toBe('starter');
    const rows = await customerRows(payer);
    expect(rows).toHaveLength(1);
    expect(rows[0].subscription_status).toBe('canceled');
  });

  it('a late, stale checkout event does not hand back a plan whose subscription is cancelled', async () => {
    const { customer, sub } = ids();
    stripeFake.subscriptionStatus = 'canceled'; // what Stripe reports now
    expect((await send(checkoutCompleted(payer.id, 'pro', customer, sub))).status).toBe(200);
    expect(await planOf(payer)).toBe('starter');
  });

  it('upgrades again on a fresh live checkout, then a cancelled update downgrades and replays safely', async () => {
    const { customer, sub } = ids();
    expect((await send(checkoutCompleted(payer.id, 'pro', customer, sub))).status).toBe(200);
    expect(await planOf(payer)).toBe('pro');

    // an "active" update is a no-op for the plan
    expect((await send(subscriptionEvent('customer.subscription.updated', customer, sub, 'active'))).status).toBe(200);
    expect(await planOf(payer)).toBe('pro');

    const canceled = subscriptionEvent('customer.subscription.updated', customer, sub, 'canceled');
    for (let i = 0; i < 2; i++) expect((await send(canceled)).status).toBe(200);
    expect(await planOf(payer)).toBe('starter');

    // an older "active" update arriving after the cancellation is recorded as status only; it
    // must not restore the plan (plan changes only come from a verified checkout).
    expect((await send(subscriptionEvent('customer.subscription.updated', customer, sub, 'active'))).status).toBe(200);
    expect(await planOf(payer)).toBe('starter');
  });

  it('ignores events for a customer it does not know', async () => {
    const res = await send(subscriptionEvent('customer.subscription.deleted', 'cus_unknown_it', 'sub_unknown_it', 'canceled'));
    expect(res.status).toBe(200);
  });

  it('ignores event types it does not handle', async () => {
    expect((await send({ type: 'invoice.paid', data: { object: {} } })).status).toBe(200);
  });
});
