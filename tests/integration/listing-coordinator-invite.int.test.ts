import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { GET as listListings } from '@/app/api/listings/route';
import { GET as getInvites } from '@/app/api/agent-invites/route';
import { POST as acceptInvite } from '@/app/api/agent-invites/accept/route';
import { GET as getCoordinator, POST as inviteCoordinator } from '@/app/api/listings/[id]/coordinator/route';
import { POST as postComment, GET as getComments } from '@/app/api/listings/[id]/comments/route';
import { GET as getListing, PATCH as patchListing, DELETE as deleteListing } from '@/app/api/listings/[id]/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// An agent with a workspace invites a coordinator onto their own listing. The listing stays the agent's; the coordinator gets
// access once they accept, can work it, but cannot delete or reassign it.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor, owner: Actor, coord: Actor, stranger: Actor, otherAgent: Actor;
let listingId: string;

beforeAll(async () => {
  boss = await createActor('lci-admin', { is_admin: true });
  coord = await createActor('lci-coord', { plan: 'pro' });
  stranger = await createActor('lci-stranger', { plan: 'pro' });
  owner = await createCollaborator('lci-owner');
  otherAgent = await createCollaborator('lci-other');
  for (const a of [owner, otherAgent]) {
    const r = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${a.id}`, params: { id: a.id }, body: { action: 'set_agent_workspace', enabled: true } });
    expect(r.status).toBe(200);
  }
  const l = await admin.from('listings').insert({ tc_user_id: owner.id, property_address: '9 Invite Ave' }).select('id').single();
  listingId = l.data!.id;
}, 60_000);

afterAll(async () => {
  await admin.from('listings').delete().eq('id', listingId);
  await cleanup();
});

const invite = (who: Actor, body: Record<string, unknown>) => call(h(inviteCoordinator), who, { method: 'POST', path: '/x', params: { id: listingId }, body });

describe('inviting a coordinator onto a listing', () => {
  it('only the owning agent can invite; not a coordinator or a stranger', async () => {
    expect((await invite(coord, { email: stranger.email })).status).toBeGreaterThanOrEqual(400);
    expect((await invite(otherAgent, { email: stranger.email })).status).toBeGreaterThanOrEqual(400);
  });
  it('refuses your own email and an agent account', async () => {
    expect((await invite(owner, { email: owner.email })).status).toBe(400);
    expect((await invite(owner, { email: otherAgent.email })).status).toBe(400);
  });
  it('sends the invite, and a duplicate is refused', async () => {
    const res = await invite(owner, { email: coord.email, usesRelay: true });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect((await invite(owner, { email: coord.email })).status).toBe(400);
    const g = (await call(h(getCoordinator), owner, { method: 'GET', path: '/x', params: { id: listingId } })).json as { invites: { email: string }[]; coordinator: unknown };
    expect(g.invites.length).toBe(1);
    expect(g.coordinator).toBeNull();
  });
  it('can be sent again', async () => {
    expect((await invite(owner, { email: coord.email, resend: true })).status).toBe(200);
  });
  it('is closed to the coordinator until accepted, and shows in their invitations', async () => {
    expect((await call(h(getListing), coord, { method: 'GET', path: '/x', params: { id: listingId } })).status).toBe(403);
    const inv = (await call(h(getInvites), coord, { method: 'GET', path: '/api/agent-invites' })).json as { kind?: string; listingId?: string }[];
    expect(inv.some((i) => i.kind === 'listing' && i.listingId === listingId)).toBe(true);
  });
  it('a stranger cannot accept someone else’s invite', async () => {
    const res = await call(h(acceptInvite), stranger, { method: 'POST', path: '/x', body: { listingId } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('after the coordinator accepts', () => {
  it('accepts', async () => {
    const res = await call(h(acceptInvite), coord, { method: 'POST', path: '/x', body: { listingId } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
  });
  it('lists it, marked coordinated, and the agent sees who accepted', async () => {
    const rows = (await call(h(listListings), coord, { method: 'GET', path: '/api/listings' })).json as { id: string; coordinated: boolean }[];
    expect(rows.find((r) => r.id === listingId)?.coordinated).toBe(true);
    const g = (await call(h(getListing), owner, { method: 'GET', path: '/x', params: { id: listingId } })).json as { invitedCoordinator: { email: string } | null };
    expect(g.invitedCoordinator?.email.toLowerCase()).toBe(coord.email.toLowerCase());
  });
  it('lets the coordinator edit but not delete or reassign', async () => {
    expect((await call(h(patchListing), coord, { method: 'PATCH', path: '/x', params: { id: listingId }, body: { notes: 'tc note' } })).status).toBeLessThan(300);
    expect((await call(h(deleteListing), coord, { method: 'DELETE', path: '/x', params: { id: listingId } })).status).toBe(403);
    for (const body of [{ tcUserId: coord.id }, { agentId: null }, { shareWithAgent: true }]) {
      expect((await call(h(patchListing), coord, { method: 'PATCH', path: '/x', params: { id: listingId }, body })).status).toBe(403);
    }
  });
  it('stays closed to strangers', async () => {
    expect((await call(h(getListing), stranger, { method: 'GET', path: '/x', params: { id: listingId } })).status).toBe(403);
  });
  it('messages go both ways with the right role', async () => {
    expect((await call(h(postComment), owner, { method: 'POST', path: '/x', params: { id: listingId }, body: { body: 'from agent' } })).status).toBe(201);
    expect((await call(h(postComment), coord, { method: 'POST', path: '/x', params: { id: listingId }, body: { body: 'from tc' } })).status).toBe(201);
    const c = (await call(h(getComments), owner, { method: 'GET', path: '/x', params: { id: listingId } })).json as { comments: { body: string; author_role: string }[] };
    expect(c.comments.find((m) => m.body === 'from agent')?.author_role).toBe('agent');
    expect(c.comments.find((m) => m.body === 'from tc')?.author_role).toBe('tc');
  });
});
