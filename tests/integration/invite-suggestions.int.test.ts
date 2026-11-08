import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { GET as suggest } from '@/app/api/invite-suggestions/route';
import { POST as inviteCoordinator } from '@/app/api/listings/[id]/coordinator/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// People to pick when adding someone to a deal or listing, so nobody has to type an email.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
type S = { name: string; email: string; source: string; recent: boolean; agentId?: string };

let boss: Actor, tc: Actor, owner: Actor, free: Actor, other: Actor;
let listingId: string;

beforeAll(async () => {
  boss = await createActor('is-admin', { is_admin: true });
  tc = await createActor('is-tc', { plan: 'pro' });
  other = await createActor('is-other', { plan: 'pro' });
  owner = await createCollaborator('is-owner');
  free = await createCollaborator('is-free');
  const r = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${owner.id}`, params: { id: owner.id }, body: { action: 'set_agent_workspace', enabled: true } });
  expect(r.status).toBe(200);
  const old = await admin.from('agents').insert({ tc_user_id: tc.id, name: 'Zed Older', email: 'zed.older@example.test', flat_fee: 0, commission_percent: 0 }).select('id').single();
  const recent = await admin.from('agents').insert({ tc_user_id: tc.id, name: 'Amy Recent', email: 'amy.recent@example.test', flat_fee: 0, commission_percent: 0 }).select('id').single();
  await admin.from('listings').insert({ tc_user_id: tc.id, agent_id: recent.data!.id, property_address: '1 Recent Rd' });
  await admin.from('contacts').insert({ tc_user_id: tc.id, name: 'Cam Contact', email: 'cam.contact@example.test', role: 'Agent' });
  await admin.from('contacts').insert({ tc_user_id: tc.id, name: 'Lena Lender', email: 'lena.lender@example.test', role: 'Lender' });
  void old;
  const l = await admin.from('listings').insert({ tc_user_id: owner.id, property_address: '2 Mine Rd' }).select('id').single();
  listingId = l.data!.id;
}, 60_000);

afterAll(async () => {
  await admin.from('listings').delete().eq('tc_user_id', tc.id);
  await admin.from('listings').delete().eq('id', listingId);
  await cleanup();
});

describe('invite suggestions', () => {
  it('offers a coordinator their agents and agent contacts, latest deals first, no lenders', async () => {
    const res = await call(h(suggest), tc, { method: 'GET', path: '/api/invite-suggestions?role=agent' });
    expect(res.status).toBe(200);
    const list = (res.json as { suggestions: S[] }).suggestions;
    expect(list[0].email).toBe('amy.recent@example.test');
    expect(list[0].recent).toBe(true);
    expect(list.map((s) => s.email)).toEqual(expect.arrayContaining(['zed.older@example.test', 'cam.contact@example.test']));
    expect(list.some((s) => s.email === 'lena.lender@example.test')).toBe(false);
  });
  it('does not leak another account’s agents or contacts', async () => {
    const list = ((await call(h(suggest), other, { method: 'GET', path: '/api/invite-suggestions?role=agent' })).json as { suggestions: S[] }).suggestions;
    expect(list.some((s) => s.email.endsWith('@example.test'))).toBe(false);
  });
  it('offers an agent the coordinators they already invited', async () => {
    expect((await call(h(inviteCoordinator), owner, { method: 'POST', path: '/x', params: { id: listingId }, body: { email: other.email } })).status).toBe(200);
    const list = ((await call(h(suggest), owner, { method: 'GET', path: '/api/invite-suggestions?role=tc' })).json as { suggestions: S[] }).suggestions;
    expect(list[0].email).toBe(other.email.toLowerCase());
    expect(list[0].recent).toBe(true);
  });
  it('is for a coordinator or a workspace agent only', async () => {
    expect((await call(h(suggest), tc, { method: 'GET', path: '/api/invite-suggestions?role=tc' })).status).toBe(403);
    expect((await call(h(suggest), free, { method: 'GET', path: '/api/invite-suggestions?role=tc' })).status).toBeGreaterThanOrEqual(400);
  });
});
