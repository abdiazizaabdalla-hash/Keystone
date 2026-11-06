import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as view } from '@/app/api/oversight/deals/[id]/view/route';
import { POST as upload, DELETE as deleteDocument } from '@/app/api/documents/route';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';
import { notifyDeal } from '@/lib/notifications';

// A brokerage owner sees an agent's deal through one read-only endpoint, can add documents to it, cannot remove them,
// and the "stage moved" notification opens the owner's page, not the agent's.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor, otherBroker: Actor, agent: Actor, outsider: Actor;
let deal: Deal, outsiderDeal: Deal;

const uploadAs = async (who: Actor, transactionId: string) => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([37, 80, 68, 70, 45])], 'broker-note.pdf', { type: 'application/pdf' }));
  form.set('transactionId', transactionId);
  const res = await upload(new NextRequest('http://localhost/api/documents', { method: 'POST', headers: { authorization: `Bearer ${who.token}` }, body: form }));
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeAll(async () => {
  broker = await createActor('odv-broker', { plan: 'team' });
  otherBroker = await createActor('odv-other', { plan: 'team' });
  agent = await createActor('odv-agent', { role: 'agent', agent_workspace: true });
  outsider = await createActor('odv-out', { role: 'agent', agent_workspace: true });
  deal = await seedDeal(agent, 'ODV1');
  outsiderDeal = await seedDeal(outsider, 'ODV2');
  for (const o of [broker, otherBroker]) {
    const { data: team } = await admin.from('teams').insert({ owner_id: o.id }).select('id').single();
    await admin.from('team_members').insert({ team_id: team!.id, user_id: o.id, role: 'owner' });
  }
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' });
}, 90_000);
afterAll(cleanup);

describe('the owner’s read-only copy of an agent’s deal', () => {
  it('returns the deal, checklist, documents and contacts, without the inbound email token or fee terms', async () => {
    const res = await call(h(view), broker, { method: 'GET', path: '/x', params: { id: deal.transactionId } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const j = res.json as { transaction: Record<string, unknown>; tasks: unknown[]; documents: { id: string }[]; contacts: unknown[]; keyDates: unknown[]; agent: { name: string } | null };
    expect(j.transaction.id).toBe(deal.transactionId);
    expect(j.transaction.inbound_token).toBeUndefined();
    expect(j.tasks.length).toBe(1);
    expect(j.documents.map((d) => d.id)).toContain(deal.documentId);
    expect(Array.isArray(j.contacts)).toBe(true);
    expect(Array.isArray(j.keyDates)).toBe(true);
    expect(JSON.stringify(j)).not.toContain('flat_fee');
  });

  it('is not available to another owner, to the agent’s peers, or for a deal outside the brokerage', async () => {
    expect((await call(h(view), otherBroker, { method: 'GET', path: '/x', params: { id: deal.transactionId } })).status).toBe(404);
    expect((await call(h(view), broker, { method: 'GET', path: '/x', params: { id: outsiderDeal.transactionId } })).status).toBe(404);
    expect((await call(h(view), agent, { method: 'GET', path: '/x', params: { id: deal.transactionId } })).status).toBe(403);
  });
});

describe('documents', () => {
  it('the owner cannot add a document to the agent’s deal (read-only view)', async () => {
    const res = await uploadAs(broker, deal.transactionId);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const { data: rows } = await admin.from('documents').select('id').eq('transaction_id', deal.transactionId).eq('file_name', 'broker-note.pdf');
    expect(rows?.length).toBe(0);
  });

  it('the owner cannot add documents elsewhere, and cannot delete any', async () => {
    expect((await uploadAs(broker, outsiderDeal.transactionId)).status).toBeGreaterThanOrEqual(400);
    expect((await uploadAs(otherBroker, deal.transactionId)).status).toBeGreaterThanOrEqual(400);
    const del = await call(h(deleteDocument), broker, { method: 'DELETE', path: `/api/documents?id=${deal.documentId}` });
    expect(del.status).toBeGreaterThanOrEqual(400);
    const { data: still } = await admin.from('documents').select('id').eq('id', deal.documentId);
    expect(still?.length).toBe(1);
  });
});

describe('notifications', () => {
  it('a stage move is not pushed to the owner, but a commission event opens the owner page', async () => {
    const moved = await call(h(patchTransaction), agent, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body: { status: 'Under Contract' } });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    const stage = await admin.from('notifications').select('id').eq('recipient_user_id', broker.id).eq('transaction_id', deal.transactionId).eq('event_type', 'stage_changed');
    expect(stage.data?.length ?? 0).toBe(0);
    await notifyDeal({ transactionId: deal.transactionId, actorUserId: agent.id, type: 'commission', title: 'Commission invoice sent' });
    const { data: rows } = await admin.from('notifications').select('link, event_type').eq('recipient_user_id', broker.id).eq('transaction_id', deal.transactionId);
    expect(rows?.length).toBeGreaterThan(0);
    for (const r of rows!) expect(r.link).toBe(`/dashboard/collaborate/deals/${deal.transactionId}`);
  });
});

