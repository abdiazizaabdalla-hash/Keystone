import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as reviewList } from '@/app/api/oversight/file-review/route';
import { PUT as setRequired } from '@/app/api/oversight/file-review/requirements/route';
import { PUT as reviewFile } from '@/app/api/oversight/file-review/[transactionId]/route';
import { POST as resend } from '@/app/api/oversight/[id]/resend/route';
import { GET as production } from '@/app/api/oversight/production/route';
import { POST as sendMessage } from '@/app/api/brokerage-messages/route';
import { NextRequest } from 'next/server';
import { admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// File review, resending an invitation, the production CSV and the email on a new private message.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor, other: Actor, agent: Actor, outsider: Actor, free: Actor;
let deal: Deal, otherDeal: Deal;
let pendingLinkId: string;

beforeAll(async () => {
  broker = await createActor('fr-broker', { plan: 'team' });
  other = await createActor('fr-other', { plan: 'team' });
  agent = await createActor('fr-agent', { role: 'agent', agent_workspace: true });
  outsider = await createActor('fr-out', { role: 'agent', agent_workspace: true });
  free = await createCollaborator('fr-free');
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' });
  const { data: pending } = await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: null, invited_email: `fr-pending-${Date.now()}@example.test`, status: 'pending' }).select('id').single();
  pendingLinkId = pending!.id as string;
  deal = await seedDeal(agent, 'FR1');
  otherDeal = await seedDeal(outsider, 'FR2');
  const today = new Date().toISOString().slice(0, 10);
  await admin.from('transactions').update({ status: 'Closed', closing_date: today, purchase_price: 400000 }).eq('id', deal.transactionId);
  await admin.from('transactions').update({ status: 'Closed', closing_date: today }).eq('id', otherDeal.transactionId);
  await admin.from('documents').update({ document_type: 'Purchase Contract', category: 'contract_disclosures' }).eq('id', deal.documentId);
}, 60_000);
afterAll(cleanup);

describe('file review', () => {
  it('is for brokerage owners only', async () => {
    expect((await call(h(reviewList), null, { method: 'GET', path: '/api/oversight/file-review' })).status).toBe(401);
    expect((await call(h(reviewList), free, { method: 'GET', path: '/api/oversight/file-review' })).status).toBe(403);
    expect((await call(h(reviewFile), agent, { method: 'PUT', path: '/x', body: { status: 'reviewed' }, params: { transactionId: deal.transactionId } })).status).toBe(403);
  });

  it('shows missing required documents for the owner’s own agents only', async () => {
    const saved = await call(h(setRequired), broker, { method: 'PUT', path: '/api/oversight/file-review/requirements', body: { types: ['Purchase Contract', 'Survey', 'Bogus'] } });
    expect(saved.status).toBe(200);
    expect((saved.json as { required: string[] }).required).toEqual(['Purchase Contract', 'Survey']);
    const list = await call(h(reviewList), broker, { method: 'GET', path: '/api/oversight/file-review' });
    const files = (list.json as { files: { id: string; missing: string[] }[] }).files;
    expect(files.map((f) => f.id)).toEqual([deal.transactionId]);
    expect(files[0].missing).toEqual(['Survey']);
    expect((await call(h(reviewList), other, { method: 'GET', path: '/api/oversight/file-review' })).json).toMatchObject({ files: [] });
  });

  it('reviews, flags (telling the agent) and clears a file, and refuses files of agents who are not theirs', async () => {
    const put = (who: Actor, id: string, body: unknown) => call(h(reviewFile), who, { method: 'PUT', path: '/x', body, params: { transactionId: id } });
    expect((await put(broker, otherDeal.transactionId, { status: 'reviewed' })).status).toBe(404);
    expect((await put(other, deal.transactionId, { status: 'reviewed' })).status).toBe(404);
    expect((await put(broker, deal.transactionId, { status: 'maybe' })).status).toBe(400);
    expect((await put(broker, deal.transactionId, { status: 'reviewed' })).status).toBe(200);
    expect(((await admin.from('brokerage_file_reviews').select('status').eq('transaction_id', deal.transactionId)).data ?? [])[0]).toMatchObject({ status: 'reviewed' });
    expect((await put(broker, deal.transactionId, { status: 'flagged', note: 'Survey is missing' })).status).toBe(200);
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', agent.id).eq('event_type', 'brokerage_file_flagged')).data ?? [];
    expect(bell).toHaveLength(1);
    const mails = (await admin.from('email_outbox').select('body, to_emails').eq('source', 'brokerage_file_flagged').eq('owner_user_id', broker.id)).data ?? [];
    expect(mails).toHaveLength(1);
    expect(mails[0].body as string).toContain('Survey is missing');
    // The agent's deal itself is untouched.
    expect(((await admin.from('transactions').select('status').eq('id', deal.transactionId)).data ?? [])[0]).toMatchObject({ status: 'Closed' });
    expect((await put(broker, deal.transactionId, { status: 'clear' })).status).toBe(200);
    expect((await admin.from('brokerage_file_reviews').select('id').eq('transaction_id', deal.transactionId)).data ?? []).toHaveLength(0);
  });
});

describe('resend an invitation', () => {
  it('re-sends a pending invitation to the outbox, at most 3 times a day, owner only', async () => {
    const send = (who: Actor | null, id: string) => call(h(resend), who, { method: 'POST', path: '/x', params: { id } });
    expect((await send(null, pendingLinkId)).status).toBe(401);
    expect((await send(other, pendingLinkId)).status).toBe(404);
    expect((await send(free, pendingLinkId)).status).toBe(403);
    for (let i = 0; i < 3; i++) expect((await send(broker, pendingLinkId)).status).toBe(200);
    expect((await send(broker, pendingLinkId)).status).toBe(429);
    expect(((await admin.from('email_outbox').select('id').eq('source', 'brokerage_invite').eq('owner_user_id', broker.id)).data ?? []).length).toBe(3);
  });

  it('does not resend an invitation that was already accepted', async () => {
    const { data: link } = await admin.from('brokerage_links').select('id').eq('owner_user_id', broker.id).eq('status', 'active').single();
    expect((await call(h(resend), broker, { method: 'POST', path: '/x', params: { id: link!.id as string } })).status).toBe(404);
  });
});

describe('production CSV', () => {
  it('has a row per agent per month for the owner’s agents only', async () => {
    const get = async (who: Actor, qs = '') => {
      const r = await production(new NextRequest(`http://localhost/api/oversight/production${qs}`, { headers: { authorization: `Bearer ${who.token}` } }));
      return { status: r.status, text: await r.text(), type: r.headers.get('content-type') };
    };
    const mine = await get(broker, `?year=${new Date().getFullYear()}`);
    expect(mine.status).toBe(200);
    expect(mine.type).toContain('text/csv');
    expect(mine.text).toContain('Month');
    expect(mine.text).toContain(agent.email);
    expect(mine.text).toContain('400000');
    expect(mine.text).not.toContain(outsider.email);
    expect((await get(other)).text).not.toContain(agent.email);
    expect((await get(free)).status).toBe(403);
  });
});

describe('email on a private message', () => {
  it('emails the other person once per burst, in both directions', async () => {
    const send = (who: Actor, to: string, body: string) => call(h(sendMessage), who, { method: 'POST', path: '/api/brokerage-messages', body: { with: to, body } });
    expect((await send(broker, agent.id, 'Hello one')).status).toBe(201);
    expect((await send(broker, agent.id, 'Hello two')).status).toBe(201);
    let mails = (await admin.from('email_outbox').select('to_emails, body').eq('source', 'brokerage_message').eq('owner_user_id', broker.id)).data ?? [];
    expect(mails).toHaveLength(1);
    expect(mails[0].to_emails as string[]).toContain(agent.email);
    expect(mails[0].body as string).toContain('Hello one');
    expect((await send(agent, broker.id, 'Reply')).status).toBe(201);
    mails = (await admin.from('email_outbox').select('to_emails, body').eq('source', 'brokerage_message').eq('owner_user_id', broker.id)).data ?? [];
    expect(mails).toHaveLength(2);
    expect(mails.some((m) => (m.to_emails as string[]).includes(broker.email))).toBe(true);
  });
});
