import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as adminList, POST as adminGrant } from '@/app/api/admin/brokerages/route';
import { POST as adminAct } from '@/app/api/admin/brokerages/[ownerId]/route';
import { GET as account, POST as accountPost } from '@/app/api/brokerage/account/route';
import { POST as invite } from '@/app/api/oversight/route';
import { POST as resend } from '@/app/api/oversight/[id]/resend/route';
import { PUT as setRequired } from '@/app/api/oversight/file-review/requirements/route';
import { GET as roster } from '@/app/api/oversight/roster/route';
import { GET as production } from '@/app/api/oversight/production/route';
import { GET as cron } from '@/app/api/cron/brokerage-pilot/route';
import { POST as sendMessage } from '@/app/api/brokerage-messages/route';
import { addDays, PILOT_DAYS } from '@/lib/brokeragePilot';
import { runPilotLifecycle } from '@/lib/brokerageAccount';
import { admin, call, cleanup, createActor, type Actor } from './helpers';

// The complimentary 30-day Brokerage Pro pilot: grant, count down, notices, expiry that keeps everything, extend once, convert, terminate.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const today = new Date().toISOString().slice(0, 10);

let boss: Actor, owner: Actor, other: Actor, notTeam: Actor, agent: Actor, free: Actor;

const asAdmin = (_path: string, body?: unknown) => call(h(adminGrant), boss, { method: 'POST', path: '/api/admin/brokerages', body });
const act = (action: string, id = owner.id, who: Actor | null = boss) => call(h(adminAct), who, { method: 'POST', path: `/api/admin/brokerages/${id}`, body: { action }, params: { ownerId: id } });
const row = async (id = owner.id) => ((await admin.from('brokerage_accounts').select('*').eq('owner_user_id', id).single()).data ?? {}) as Record<string, unknown>;
const setEnds = (date: string, status = 'pilot') => admin.from('brokerage_accounts').update({ pilot_ends_on: date, status }).eq('owner_user_id', owner.id);
const mails = async (source: string) => ((await admin.from('email_outbox').select('to_emails, subject, body').eq('source', source).eq('owner_user_id', owner.id)).data ?? []);
const inviteMail = (who: Actor, email: string) => call(h(invite), who, { method: 'POST', path: '/api/oversight', body: { email } });

beforeAll(async () => {
  boss = await createActor('pl-admin', { is_admin: true });
  owner = await createActor('pl-owner', { plan: 'team' });
  other = await createActor('pl-other', { plan: 'team' });
  notTeam = await createActor('pl-solo', { plan: 'starter' });
  agent = await createActor('pl-agent', { role: 'agent', agent_workspace: true });
  free = await createActor('pl-free', { role: 'agent' });
  await admin.from('brokerage_links').insert({ owner_user_id: owner.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' });
}, 60_000);
afterAll(cleanup);

describe('granting a pilot', () => {
  it('is for admins only, and only for someone on a Team plan', async () => {
    expect((await call(h(adminGrant), owner, { method: 'POST', path: '/api/admin/brokerages', body: { email: owner.email } })).status).toBe(403);
    expect((await asAdmin('/x', { email: notTeam.email })).status).toBe(400);
    expect((await asAdmin('/x', { email: 'nobody-at-all@example.test' })).status).toBe(404);
  });

  it('lists an owner with agents but no account as unmanaged, before the pilot starts', async () => {
    const list = (await call(h(adminList), boss, { method: 'GET', path: '/api/admin/brokerages' })).json as { unmanaged: { ownerId: string }[] };
    expect(list.unmanaged.map((u) => u.ownerId)).toContain(owner.id);
  });

  it('starts 30 days of Pro with 25 agents, emails the owner, and cannot be granted twice', async () => {
    const res = await asAdmin('/x', { email: owner.email, note: 'First pilot' });
    expect(res.status).toBe(201);
    expect((res.json as { endsOn: string }).endsOn).toBe(addDays(today, PILOT_DAYS));
    expect(await row()).toMatchObject({ status: 'pilot', tier: 'pro', extension_used: false });
    const welcome = await mails('brokerage_pilot_granted');
    expect(welcome).toHaveLength(1);
    expect(welcome[0].body as string).toMatch(/no payment|not be charged/i);
    expect((await asAdmin('/x', { email: owner.email })).status).toBe(409);
    const status = await call(h(account), owner, { method: 'GET', path: '/api/brokerage/account' });
    expect(status.json).toMatchObject({ account: { status: 'pilot', daysLeft: 30, canManage: true, seats: { active: 1, limit: 25 } } });
  });

  it('shows the account to its owner only', async () => {
    expect((await call(h(account), other, { method: 'GET', path: '/x' })).json).toMatchObject({ account: null });
    expect((await call(h(account), free, { method: 'GET', path: '/x' })).status).toBe(403);
  });

  it('never touches billing: no Stripe fields exist on the account', async () => {
    expect(Object.keys(await row()).filter((k) => /stripe|subscription|customer|price/i.test(k))).toEqual([]);
  });
});

describe('during the pilot', () => {
  it('lets the owner invite, up to the 25-agent allowance counting open invitations', async () => {
    expect((await inviteMail(owner, `pl-in-${Date.now()}@example.test`)).status).toBe(201);
    const rows = Array.from({ length: 23 }, (_, i) => ({ owner_user_id: owner.id, agent_user_id: null, invited_email: `pl-fill-${i}-${Date.now()}@example.test`, status: 'pending' }));
    await admin.from('brokerage_links').insert(rows);
    const full = await inviteMail(owner, `pl-over-${Date.now()}@example.test`);
    expect(full.status).toBe(400);
    expect((full.json as { error: string }).error).toMatch(/includes 25 agents/);
    await admin.from('brokerage_links').delete().eq('owner_user_id', owner.id).eq('status', 'pending');
  });
});

describe('notices at 14, 7 and 3 days and on the day', () => {
  it('sends each once and does not repeat', async () => {
    await setEnds(addDays(today, 14));
    expect((await runPilotLifecycle(today)).notices).toBe(1);
    expect((await runPilotLifecycle(today)).notices).toBe(0);
    expect(await mails('brokerage_pilot_notice_14')).toHaveLength(1);
    await setEnds(addDays(today, 7));
    await runPilotLifecycle(today);
    await setEnds(addDays(today, 3));
    await runPilotLifecycle(today);
    expect(await mails('brokerage_pilot_notice_7')).toHaveLength(1);
    expect(await mails('brokerage_pilot_notice_3')).toHaveLength(1);
    expect(((await mails('brokerage_pilot_notice_3'))[0].body as string)).toMatch(/not charged/);
    expect(((await admin.from('notifications').select('title').eq('recipient_user_id', owner.id).eq('event_type', 'brokerage_account')).data ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('needs the cron secret', async () => {
    expect((await cron(new NextRequest('http://localhost/api/cron/brokerage-pilot'))).status).toBe(401);
  });
});

describe('when the pilot ends', () => {
  it('tells the owner, records pilot_expired, and deletes nothing', async () => {
    await setEnds(today);
    const out = await runPilotLifecycle(today);
    expect(out.expired).toBe(1);
    expect(await mails('brokerage_pilot_notice_0')).toHaveLength(1);
    expect(await row()).toMatchObject({ status: 'pilot_expired' });
    const links = (await admin.from('brokerage_links').select('status').eq('owner_user_id', owner.id).eq('status', 'active')).data ?? [];
    expect(links).toHaveLength(1);
    const kinds = ((await admin.from('brokerage_account_events').select('kind').eq('owner_user_id', owner.id)).data ?? []).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['granted', 'expired', 'notice_14', 'notice_0']));
  });

  it('stops managing: no invitations, resends, file-review changes', async () => {
    const blocked = await inviteMail(owner, `pl-late-${Date.now()}@example.test`);
    expect(blocked.status).toBe(403);
    expect((blocked.json as { error: string }).error).toMatch(/pilot has ended/);
    expect((await call(h(setRequired), owner, { method: 'PUT', path: '/x', body: { types: ['Survey'] } })).status).toBe(403);
    const { data: pending } = await admin.from('brokerage_links').insert({ owner_user_id: owner.id, agent_user_id: null, invited_email: `pl-p-${Date.now()}@example.test`, status: 'pending' }).select('id').single();
    expect((await call(h(resend), owner, { method: 'POST', path: '/x', params: { id: pending!.id as string } })).status).toBe(403);
  });

  it('keeps everything readable and exportable, and messaging works', async () => {
    expect((await call(h(roster), owner, { method: 'GET', path: '/x' })).status).toBe(200);
    const csv = await production(new NextRequest('http://localhost/api/oversight/production', { headers: { authorization: `Bearer ${owner.token}` } }));
    expect(csv.status).toBe(200);
    expect((await call(h(sendMessage), owner, { method: 'POST', path: '/x', body: { with: agent.id, body: 'Still here' } })).status).toBe(201);
    const st = await call(h(account), owner, { method: 'GET', path: '/x' });
    expect(st.json).toMatchObject({ account: { status: 'pilot_expired', canManage: false, canRequestUpgrade: true } });
  });

  it('lets the owner ask to upgrade, and every admin is told', async () => {
    expect((await call(h(accountPost), owner, { method: 'POST', path: '/x', body: { action: 'request_upgrade' } })).status).toBe(200);
    expect((await row()).upgrade_requested_at).toBeTruthy();
    expect(((await admin.from('notifications').select('id').eq('recipient_user_id', boss.id).eq('event_type', 'brokerage_upgrade_request')).data ?? []).length).toBe(1);
  });
});

describe('admin controls', () => {
  it('allow one 15-day extension, which restarts an expired pilot', async () => {
    expect((await act('extend', owner.id, owner)).status).toBe(403);
    const res = await act('extend');
    expect(res.status).toBe(200);
    expect((res.json as { endsOn: string }).endsOn).toBe(addDays(today, 15));
    expect(await row()).toMatchObject({ status: 'pilot', extension_used: true });
    expect((await inviteMail(owner, `pl-back-${Date.now()}@example.test`)).status).toBe(201);
    expect((await act('extend')).status).toBe(409);
  });

  it('terminate pauses management and keeps every record', async () => {
    expect((await act('terminate')).status).toBe(200);
    expect(await row()).toMatchObject({ status: 'terminated' });
    expect((await inviteMail(owner, `pl-term-${Date.now()}@example.test`)).status).toBe(403);
    expect((await call(h(roster), owner, { method: 'GET', path: '/x' })).status).toBe(200);
    expect((await act('terminate')).status).toBe(409);
    expect((await act('convert')).status).toBe(409);
  });

  it('convert records the paid plan without any billing and restores full Pro', async () => {
    const o2 = await createActor('pl-conv', { plan: 'team' });
    expect((await asAdmin('/x', { email: o2.email })).status).toBe(201);
    await admin.from('brokerage_accounts').update({ pilot_ends_on: addDays(today, -3) }).eq('owner_user_id', o2.id);
    expect((await inviteMail(o2, `pl-c1-${Date.now()}@example.test`)).status).toBe(403);
    expect((await act('convert', o2.id)).status).toBe(200);
    expect(await row(o2.id)).toMatchObject({ status: 'converted', tier: 'pro' });
    expect((await row(o2.id)).converted_on).toBe(today);
    expect((await inviteMail(o2, `pl-c2-${Date.now()}@example.test`)).status).toBe(201);
    expect((await call(h(accountPost), o2, { method: 'POST', path: '/x', body: { action: 'request_upgrade' } })).status).toBe(409);
    expect((await act('convert', other.id)).status).toBe(404);
  });
});
