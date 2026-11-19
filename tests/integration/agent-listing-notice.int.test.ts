import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createListing } from '@/app/api/listings/route';
import { GET as agentListings } from '@/app/api/agent/listings/route';
import { POST as markSeen } from '@/app/api/agent/listings/seen/route';
import { admin, call, cleanup, createActor, type Actor } from './helpers';

// When a coordinator adds an agent to a listing, the agent's dashboard announces it once.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let agent: Actor;
let stranger: Actor;
let listingId: string;
let hasColumn = true;

const isNew = async (who: Actor) => {
  const res = await call(h(agentListings), who, { method: 'GET', path: '/api/agent/listings' });
  return (res.json as { id: string; isNew: boolean }[]).find((l) => l.id === listingId)?.isNew;
};

beforeAll(async () => {
  tc = await createActor('aln-tc', { plan: 'pro' });
  agent = await createActor('aln-agent', { role: 'agent', account_type: 'agent' });
  stranger = await createActor('aln-stranger', { role: 'agent', account_type: 'agent' });
  const a = await call(h(createAgent), tc, { method: 'POST', path: '/api/agents', body: { name: 'Notified', email: agent.email, flatFee: 400, percentFee: 0 } });
  expect(a.status, JSON.stringify(a.json)).toBeLessThan(300);
  const l = await call(h(createListing), tc, { method: 'POST', path: '/api/listings', body: { propertyAddress: '5 Notice Ct', agentId: (a.json as { id: string }).id, inviteAgent: false } });
  expect(l.status, JSON.stringify(l.json)).toBeLessThan(300);
  listingId = ((l.json as { listing?: { id: string }; id?: string }).listing?.id || (l.json as { id: string }).id) as string;
  hasColumn = !(await admin.from('listings').select('agent_notice_seen').eq('id', listingId).single()).error;
}, 60_000);

afterAll(async () => {
  if (listingId) await admin.from('listings').delete().eq('id', listingId);
  await cleanup();
});

describe('added to a listing', () => {
  it('is announced to the agent as new', async () => {
    expect(await isNew(agent)).toBe(true);
  });

  it('is hidden once seen (needs add-listing-agent-notice.sql)', async () => {
    const res = await call(h(markSeen), agent, { method: 'POST', path: '/api/agent/listings/seen', body: { ids: [listingId] } });
    expect(res.status).toBe(200);
    if (!hasColumn) return;
    expect(await isNew(agent)).toBe(false);
  });

  it('cannot be marked seen by someone it is not shared with', async () => {
    if (hasColumn) await admin.from('listings').update({ agent_notice_seen: false }).eq('id', listingId);
    await call(h(markSeen), stranger, { method: 'POST', path: '/api/agent/listings/seen', body: { ids: [listingId] } });
    if (!hasColumn) return;
    expect(await isNew(agent)).toBe(true);
  });

  it('is announced again when the coordinator turns sharing back on or changes the agent', async () => {
    if (!hasColumn) return;
    const { PATCH } = await import('@/app/api/listings/[id]/route');
    await admin.from('listings').update({ agent_notice_seen: true, share_with_agent: false }).eq('id', listingId);
    const r = await call(h(PATCH), tc, { method: 'PATCH', path: `/api/listings/${listingId}`, params: { id: listingId }, body: { shareWithAgent: true, notifyAgent: false } });
    expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
    expect(await isNew(agent)).toBe(true);
  });
});
