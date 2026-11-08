import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as adminPatch } from '@/app/api/admin/users/[id]/route';
import { GET as listListings } from '@/app/api/listings/route';
import { POST as postComment, GET as getComments } from '@/app/api/listings/[id]/comments/route';
import { GET as getListing, PATCH as patchListing, DELETE as deleteListing } from '@/app/api/listings/[id]/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// A listing a coordinator shares with an agent opens inside the agent's own workspace, like shared deals do: listed with the
// agent's own, editable, but not deletable or reassignable. A free agent still only gets the limited portal.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let boss: Actor, tc: Actor, paid: Actor, free: Actor, stranger: Actor;
let listingId: string, hiddenId: string;

beforeAll(async () => {
  boss = await createActor('lsi-admin', { is_admin: true });
  tc = await createActor('lsi-tc', { plan: 'pro' });
  paid = await createCollaborator('lsi-paid');
  free = await createCollaborator('lsi-free');
  stranger = await createCollaborator('lsi-stranger');
  for (const a of [paid, stranger]) {
    const r = await call(h(adminPatch), boss, { method: 'PATCH', path: `/api/admin/users/${a.id}`, params: { id: a.id }, body: { action: 'set_agent_workspace', enabled: true } });
    expect(r.status).toBe(200);
  }
  const ag = await admin.from('agents').insert({ tc_user_id: tc.id, name: 'Paid Agent', email: paid.email, flat_fee: 0, commission_percent: 0 }).select('id').single();
  const l = await admin.from('listings').insert({ tc_user_id: tc.id, agent_id: ag.data!.id, property_address: '1 Shared Ln', share_with_agent: true }).select('id').single();
  const hid = await admin.from('listings').insert({ tc_user_id: tc.id, agent_id: ag.data!.id, property_address: '2 Private Ln', share_with_agent: false }).select('id').single();
  listingId = l.data!.id;
  hiddenId = hid.data!.id;
}, 60_000);

afterAll(async () => {
  await admin.from('listings').delete().in('id', [listingId, hiddenId]);
  await cleanup();
});

describe('shared listings inside the workspace', () => {
  it('are listed for the agent, marked shared, and not the ones left unshared', async () => {
    const res = await call(h(listListings), paid, { method: 'GET', path: '/api/listings' });
    expect(res.status).toBe(200);
    const rows = res.json as { id: string; shared: boolean }[];
    expect(rows.find((r) => r.id === listingId)?.shared).toBe(true);
    expect(rows.some((r) => r.id === hiddenId)).toBe(false);
  });
  it('open fully and can be edited', async () => {
    expect((await call(h(getListing), paid, { method: 'GET', path: `/api/listings/${listingId}`, params: { id: listingId } })).status).toBe(200);
    const up = await call(h(patchListing), paid, { method: 'PATCH', path: `/api/listings/${listingId}`, params: { id: listingId }, body: { notes: 'agent note' } });
    expect(up.status, JSON.stringify(up.json)).toBeLessThan(300);
  });
  it('cannot be deleted, handed over or re-assigned by the agent', async () => {
    expect((await call(h(deleteListing), paid, { method: 'DELETE', path: '/x', params: { id: listingId } })).status).toBe(403);
    for (const body of [{ agentId: null }, { shareWithAgent: false }, { notifyAgent: true }]) {
      expect((await call(h(patchListing), paid, { method: 'PATCH', path: '/x', params: { id: listingId }, body })).status).toBe(403);
    }
  });
  it('hide the coordinator’s private notes and keep the agent from overwriting them', async () => {
    await admin.from('listings').update({ notes: 'TC private' }).eq('id', listingId);
    const g = (await call(h(getListing), paid, { method: 'GET', path: '/x', params: { id: listingId } })).json as { shared: boolean; listing: { notes: string | null }; activity: unknown[] };
    expect(g.shared).toBe(true);
    expect(g.listing.notes).toBeNull();
    expect(g.activity).toEqual([]);
    await call(h(patchListing), paid, { method: 'PATCH', path: '/x', params: { id: listingId }, body: { notes: 'overwrite' } });
    expect((await admin.from('listings').select('notes').eq('id', listingId).single()).data!.notes).toBe('TC private');
    const own = (await call(h(getListing), tc, { method: 'GET', path: '/x', params: { id: listingId } })).json as { shared: boolean; listing: { notes: string } };
    expect(own.shared).toBe(false);
    expect(own.listing.notes).toBe('TC private');
  });
  it('a message from the agent in the workspace is posted as the agent', async () => {
    const r = await call(h(postComment), paid, { method: 'POST', path: '/x', params: { id: listingId }, body: { body: 'hello coordinator' } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const list = (await call(h(getComments), tc, { method: 'GET', path: '/x', params: { id: listingId } })).json as { comments: { author_role?: string; body: string }[] };
    expect(list.comments.find((c) => c.body === 'hello coordinator')?.author_role).toBe('agent');
  });
  it('stay closed to an unshared listing, another agent and a free agent', async () => {
    for (const [who, id] of [[paid, hiddenId], [stranger, listingId], [free, listingId]] as [Actor, string][]) {
      const r = await call(h(getListing), who, { method: 'GET', path: '/x', params: { id } });
      expect([403, 404]).toContain(r.status);
    }
  });
});
