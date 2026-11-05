import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/commissions/route';
import { POST as generate } from '@/app/api/commissions/generate/route';
import { GET as invoiceOptions } from '@/app/api/commissions/invoice-options/route';
import { POST as propose } from '@/app/api/commissions/route';
import { PATCH } from '@/app/api/commissions/[id]/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// The agent asks for the commission statement on a deal. It starts as an estimate built from their brokerage's base terms, with no
// gross for the agent to type. Statements an agent generated before this (a request with a gross, waiting for approval) still work:
// the owner approves them as they are, or edits them and the agent agrees again, then records payment.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const gen = (who: Actor | null, body: Record<string, unknown>) => call(h(generate), who, { method: 'POST', path: '/api/commissions/generate', body });
const forDeal = (who: Actor, id: string) => call(h(GET), who, { method: 'GET', path: `/api/commissions?transaction=${id}` });
const act = (who: Actor, id: string, body: Record<string, unknown>) => call(h(PATCH), who, { method: 'PATCH', path: '/x', params: { id }, body });
type View = { id: string; status: string; submitted: boolean; grossStatus: string; agentNet: number | null; brokerageNet: number | null; gross: number | null };
const v = (r: { json: unknown }) => r.json as View;

let broker: Actor;
let agent: Actor;
let loner: Actor; // an agent in no brokerage
let noSplit: Actor; // in a brokerage that has not set a split
let other: Actor; // a second agent in the first brokerage
let d1: Deal, d2: Deal, d3: Deal, dLoner: Deal, dNoSplit: Deal, dOther: Deal, dOpen: Deal;

/** A statement the way an agent generated one before estimates: a gross, waiting for the owner's approval. */
async function legacyInvoice(deal: Deal, gross: number) {
  const { data, error } = await admin
    .from('deal_commissions')
    .insert({ transaction_id: deal.transactionId, owner_user_id: broker.id, agent_user_id: agent.id, statement_number: `COMM-${Math.floor(Math.random() * 9000) + 1000}`, gross_cents: gross * 100, split_type: 'percent', split_value: 80, deductions: [], agent_net_cents: gross * 80, brokerage_net_cents: gross * 20, status: 'change_requested', change_note: null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

beforeAll(async () => {
  broker = await createActor('ci-broker', { plan: 'team' });
  const broker2 = await createActor('ci-broker2', { plan: 'team' });
  agent = await createActor('ci-agent', { role: 'agent', agent_workspace: true });
  loner = await createActor('ci-loner', { role: 'agent', agent_workspace: true });
  noSplit = await createActor('ci-nosplit', { role: 'agent', agent_workspace: true });
  other = await createActor('ci-other', { role: 'agent', agent_workspace: true });
  [d1, d2, d3] = [await seedDeal(agent, 'CI1'), await seedDeal(agent, 'CI2'), await seedDeal(agent, 'CI3')];
  dLoner = await seedDeal(loner, 'CIL');
  dNoSplit = await seedDeal(noSplit, 'CIN');
  dOther = await seedDeal(other, 'CIO');
  dOpen = await seedDeal(agent, 'CIOPEN');
  // Commission only exists once a deal has closed; dOpen stays open on purpose.
  await admin.from('transactions').update({ status: 'Closed' }).in('id', [d1, d2, d3, dLoner, dNoSplit, dOther].map((x) => x.transactionId));
  for (const o of [broker, broker2]) {
    const { data: team } = await admin.from('teams').insert({ owner_id: o.id }).select('id').single();
    await admin.from('team_members').insert({ team_id: team!.id, user_id: o.id, role: 'owner' });
  }
  await admin.from('brokerage_links').insert([
    { owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', default_split_type: 'percent', default_split_value: 80 },
    { owner_user_id: broker.id, agent_user_id: other.id, invited_email: other.email, status: 'active', default_split_type: 'percent', default_split_value: 70 },
    { owner_user_id: broker2.id, agent_user_id: noSplit.id, invited_email: noSplit.email, status: 'active' },
  ]);
}, 90_000);
afterAll(cleanup);

describe('asking for the statement', () => {
  it('works on a deal that is still open: an estimate the owner confirms when it closes', async () => {
    const res = await gen(agent, { transactionId: dOpen.transactionId });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(v(res)).toMatchObject({ status: 'estimate', gross: null, agentNet: null });
    // the broker sees it on the deal, and it is not confirmable until the deal closes
    const owner = (await forDeal(broker, dOpen.transactionId)).json as { role: string; canPropose: boolean; commission: View | null };
    expect(owner.role).toBe('owner');
    expect(owner.commission?.status).toBe('estimate');
    expect(owner.canPropose).toBe(false);
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', broker.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.some((b) => /before closing/.test(String(b.title)))).toBe(true);
  });
  it('an agent with an open deal and terms is offered the invoice before anything exists', async () => {
    const open2 = await seedDeal(agent, 'CIOPEN2');
    const res = (await forDeal(agent, open2.transactionId)).json as { canInvoice?: boolean; commission: unknown; brokerage?: { name: string } };
    expect(res.canInvoice).toBe(true);
    expect(res.commission).toBeNull();
    const { data } = await admin.from('deal_commissions').select('id').eq('transaction_id', open2.transactionId);
    expect(data).toEqual([]);
  });
  it('needs a login, an agent workspace, their own deal, a brokerage and a base split', async () => {
    expect((await gen(null, { transactionId: d1.transactionId })).status).toBe(401);
    expect((await gen(broker, { transactionId: d1.transactionId })).status).toBe(403);
    expect((await gen(agent, { transactionId: dOther.transactionId })).status).toBe(404);
    expect((await gen(agent, {})).status).toBe(400);
    expect((await gen(loner, { transactionId: dLoner.transactionId })).status).toBe(409);
    expect((await gen(noSplit, { transactionId: dNoSplit.transactionId })).status).toBe(400);
  });

  it('with no terms the agent sees a note and nothing is invented', async () => {
    const res = (await forDeal(noSplit, dNoSplit.transactionId)).json as { awaitingTerms?: boolean; commission: unknown };
    expect(res.awaitingTerms).toBe(true);
    expect(res.commission).toBeNull();
    const { data } = await admin.from('deal_commissions').select('id').eq('transaction_id', dNoSplit.transactionId);
    expect(data).toEqual([]);
  });

  it('makes an estimate with no gross, ignores any gross sent, and tells the owner', async () => {
    const res = await gen(agent, { transactionId: d1.transactionId, gross: 10000 });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(v(res)).toMatchObject({ status: 'estimate', grossStatus: 'estimate', gross: null, agentNet: null, brokerageNet: null, submitted: false });
    // asking again returns the same statement
    const again = await gen(agent, { transactionId: d1.transactionId });
    expect(again.status).toBe(200);
    expect(v(again).id).toBe(v(res).id);
    const after = (await forDeal(agent, d1.transactionId)).json as { role: string; commission: View };
    expect(after.role).toBe('agent');
    expect(after.commission.grossStatus).toBe('estimate');
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', broker.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.some((b) => /sent a commission invoice/.test(String(b.title)))).toBe(true);
  });
});

describe('what the agent sees when they start an invoice', () => {
  type Options = { inBrokerage: boolean; brokerage?: { name: string }; termsSet?: boolean; deals?: { id: string; closed: boolean; statement: { status: string } | null; preview: { gross: number | null; agentNet: number | null; split: { type: string; value: number } | null } | null }[] };
  const options = (who: Actor | null) => call(h(invoiceOptions), who, { method: 'GET', path: '/api/commissions/invoice-options' });
  it('needs a login and an agent workspace', async () => {
    expect((await options(null)).status).toBe(401);
    expect((await options(broker)).status).toBe(403);
  });
  it('an agent in no brokerage has nothing to invoice', async () => {
    expect(((await options(loner)).json as Options).inBrokerage).toBe(false);
  });
  it('lists the brokerage as the bill-to and the deals, open and closed, with the split filled in from the terms', async () => {
    const res = (await options(agent)).json as Options;
    expect(res.inBrokerage).toBe(true);
    expect(res.termsSet).toBe(true);
    expect(res.brokerage?.name).toBeTruthy();
    const open = res.deals!.find((d) => d.id === dOpen.transactionId);
    const closed = res.deals!.find((d) => d.id === d3.transactionId);
    expect(open).toMatchObject({ closed: false });
    expect(closed).toMatchObject({ closed: true });
    // d3 has no invoice yet, so it comes with the calculation worked out from the brokerage's terms
    expect(closed?.statement).toBeNull();
    expect(closed?.preview?.split).toEqual({ type: 'percent', value: 80 });
    // dOpen was sent above, so it shows as the invoice that exists, not a fresh preview
    expect(open?.statement?.status).toBe('estimate');
    expect(open?.preview).toBeNull();
  });
  it('never lists another agent’s deals', async () => {
    const res = (await options(agent)).json as Options;
    expect(res.deals!.some((d) => d.id === dOther.transactionId)).toBe(false);
  });
  it('with no terms set there is nothing to calculate', async () => {
    const res = (await options(noSplit)).json as Options;
    expect(res).toMatchObject({ inBrokerage: true, termsSet: false });
  });
});

describe('older agent invoices still work: approving and paying', () => {
  let id = '';
  it('only the owner can approve, and then the agent’s invoice is agreed', async () => {
    id = await legacyInvoice(d2, 10000);
    expect((await act(agent, id, { action: 'approve' })).status).toBe(400);
    expect((await act(agent, id, { action: 'request_change', note: 'x' })).status).toBe(409);
    expect((await act(other, id, { action: 'approve' })).status).toBe(404);
    const ok = await act(broker, id, { action: 'approve' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(v(ok)).toMatchObject({ status: 'accepted', submitted: false, grossStatus: 'confirmed' });
    expect((await act(broker, id, { action: 'approve' })).status).toBe(409);
  });

  it('then the owner records the payment', async () => {
    expect(v(await act(broker, id, { action: 'mark_paid' }))).toMatchObject({ status: 'paid' });
  });
});

describe('editing instead', () => {
  it('an edit goes back to the agent to agree, and cannot be approved', async () => {
    const created = await legacyInvoice(d3, 9000);
    const edited = await call(h(propose), broker, { method: 'POST', path: '/api/commissions', body: { transactionId: d3.transactionId, gross: 9000, splitType: 'percent', splitValue: 75 } });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect(v(edited)).toMatchObject({ status: 'proposed', submitted: false, agentNet: 6750 });
    expect((await act(broker, created, { action: 'approve' })).status).toBe(409);
    expect(v(await act(agent, created, { action: 'accept' })).status).toBe('accepted');
  });
});
