import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/commissions/route';
import { PATCH } from '@/app/api/commissions/[id]/route';
import { GET as statement } from '@/app/api/commissions/[id]/statement/route';
import { PATCH as setTerms } from '@/app/api/oversight/[id]/route';
import { ensureEstimateStatement } from '@/lib/commissions';
import { NextRequest } from 'next/server';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// Step 1 of the commission workflow: a statement starts as an ESTIMATE from the agent's base terms (split, fees, cap), with no amounts.
// The brokerage owner confirms the actual gross commission; only then can the agent review it. Nothing is invented when there are
// no terms, the agent can never confirm amounts or payment, and statements that already existed keep their status and figures.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const forDeal = (who: Actor, id: string) => call(h(GET), who, { method: 'GET', path: `/api/commissions?transaction=${id}` });
const post = (who: Actor | null, body: Record<string, unknown>) => call(h(POST), who, { method: 'POST', path: '/api/commissions', body });
const act = (who: Actor, id: string, body: Record<string, unknown>) => call(h(PATCH), who, { method: 'PATCH', path: '/x', params: { id }, body });
const terms = (who: Actor, linkId: string, body: Record<string, unknown>) => call(h(setTerms), who, { method: 'PATCH', path: '/x', params: { id: linkId }, body });
const pdf = (who: Actor, id: string) => statement(new NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${who.token}` } }), { params: Promise.resolve({ id }) });

type View = { id: string; status: string; grossStatus: string; gross: number | null; agentNet: number | null; brokerageNet: number | null; deductions: { label: string; amount: number }[]; changeNote: string | null; confirmedAt: string | null; splitValue: number };
type Deal1 = { role: string | null; awaitingTerms?: boolean; commission: View | null; terms?: { split: { type: string; value: number } | null; fees: { label: string; amount: number }[]; cap: { capCents: number } | null } | null; cap?: { state: string; usedCents: number; percent: number } | null };
const d = (r: { json: unknown }) => r.json as Deal1;
const v = (r: { json: unknown }) => r.json as View;

let broker: Actor, agent: Actor, bare: Actor, outsider: Actor, otherBroker: Actor;
let dealA: Deal, dealB: Deal, dealC: Deal, dealD: Deal, dealBare: Deal, dealOut: Deal, dealOpen: Deal;
let linkId = '';
const year = new Date().getUTCFullYear();

beforeAll(async () => {
  broker = await createActor('ce-broker', { plan: 'team' });
  otherBroker = await createActor('ce-other', { plan: 'team' });
  agent = await createActor('ce-agent', { role: 'agent', agent_workspace: true });
  bare = await createActor('ce-bare', { role: 'agent', agent_workspace: true });
  outsider = await createActor('ce-out', { role: 'agent', agent_workspace: true });
  [dealA, dealB, dealC, dealD] = [await seedDeal(agent, 'CEA'), await seedDeal(agent, 'CEB'), await seedDeal(agent, 'CEC'), await seedDeal(agent, 'CED')];
  dealBare = await seedDeal(bare, 'CEBARE');
  dealOut = await seedDeal(outsider, 'CEOUT');
  dealOpen = await seedDeal(agent, 'CEOPEN');
  for (const o of [broker, otherBroker]) {
    const { data: team } = await admin.from('teams').insert({ owner_id: o.id }).select('id').single();
    await admin.from('team_members').insert({ team_id: team!.id, user_id: o.id, role: 'owner' });
  }
  const { data: link } = await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' }).select('id').single();
  linkId = link!.id as string;
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: bare.id, invited_email: bare.email, status: 'active' });
  // Commission only exists once a deal has closed; dealOpen stays open on purpose. dealA sold for 500,000.
  await admin.from('transactions').update({ status: 'Closed' }).in('id', [dealA, dealB, dealC, dealD, dealBare, dealOut].map((x) => x.transactionId));
  await admin.from('transactions').update({ purchase_price: 500000 }).eq('id', dealA.transactionId);
  await admin.from('transactions').update({ purchase_price: 500000 }).eq('id', dealOpen.transactionId);
  for (const [deal, date] of [[dealA, `${year}-03-01`], [dealB, `${year}-04-01`], [dealC, `${year}-05-01`]] as const) await admin.from('transactions').update({ closing_date: date }).eq('id', deal.transactionId);
}, 90_000);
afterAll(cleanup);

describe('base terms: split, fees and cap', () => {
  it('are validated and saved partially, and clearable', async () => {
    expect((await terms(broker, linkId, {})).status).toBe(400);
    expect((await terms(broker, linkId, { cap: { amount: 0, reset: 'calendar_year' } })).status).toBe(400);
    expect((await terms(broker, linkId, { cap: { amount: 5000, reset: 'whenever' } })).status).toBe(400);
    expect((await terms(broker, linkId, { cap: { amount: 5000, reset: 'anniversary', start: 'soon' } })).status).toBe(400);
    expect((await terms(broker, linkId, { fees: [{ label: '', amount: 5 }] })).status).toBe(400);
    expect((await terms(broker, linkId, { fees: [{ label: 'E&O', amount: -1 }] })).status).toBe(400);
    expect((await terms(agent, linkId, { fees: [] })).status).toBe(403);
    expect((await terms(otherBroker, linkId, { fees: [] })).status).toBe(404);

    for (const bad of [{ commissionType: 'percent', commissionValue: 101 }, { commissionType: 'percent', commissionValue: -1 }, { commissionType: 'flat', commissionValue: -5 }, { commissionType: 'weird', commissionValue: 3 }, { commissionType: 'percent', commissionValue: 'abc' }]) {
      expect((await terms(broker, linkId, bad)).status).toBe(400);
    }
    expect((await terms(agent, linkId, { commissionType: 'percent', commissionValue: 3 })).status).toBe(403);
    expect((await terms(broker, linkId, { commissionType: 'percent', commissionValue: 3 })).status).toBe(200);
    expect((await terms(broker, linkId, { splitType: 'percent', splitValue: 70 })).status).toBe(200);
    expect((await terms(broker, linkId, { fees: [{ label: 'Transaction fee', amount: 395 }, { label: 'E&O', amount: 100 }] })).status).toBe(200);
    expect((await terms(broker, linkId, { cap: { amount: 10000, reset: 'calendar_year' } })).status).toBe(200);
    const { data } = await admin.from('brokerage_links').select('default_commission_type, default_commission_value, default_split_type, default_split_value, default_fees, cap_cents, cap_reset').eq('id', linkId).single();
    expect(data).toMatchObject({ default_commission_type: 'percent', default_commission_value: 3, default_split_type: 'percent', default_split_value: 70, cap_cents: 1_000_000, cap_reset: 'calendar_year' });
    expect(data!.default_fees).toEqual([{ label: 'Transaction fee', amount: 395, when: 'agent_share' }, { label: 'E&O', amount: 100, when: 'agent_share' }]);
  });
});

describe('the estimate', () => {
  it('is made for a deal from the base terms, with no amounts, and only once', async () => {
    const made = await ensureEstimateStatement(dealA.transactionId);
    expect(made).toMatchObject({ status: 'estimate', gross_cents: null, agent_net_cents: null, brokerage_net_cents: null, split_type: 'percent', split_value: 70, owner_user_id: broker.id, agent_user_id: agent.id });
    expect(made!.deductions).toEqual([{ label: 'Transaction fee', amount: 395 }, { label: 'E&O', amount: 100 }]);
    expect(made!.cap_snapshot).toMatchObject({ capCents: 1_000_000, reset: 'calendar_year' });
    // 3% of the 500,000 sale price is the expected gross, kept as an expectation and never as a confirmed amount
    expect(made).toMatchObject({ commission_type: 'percent', estimated_gross_cents: 1_500_000 });
    const again = await ensureEstimateStatement(dealA.transactionId);
    expect(again!.id).toBe(made!.id);
    const { data } = await admin.from('deal_commissions').select('id').eq('transaction_id', dealA.transactionId);
    expect(data).toHaveLength(1);
  });

  it('is not made when the agent has no terms, no brokerage, or is in someone else’s brokerage', async () => {
    expect(await ensureEstimateStatement(dealBare.transactionId)).toBeNull();
    expect(await ensureEstimateStatement(dealOut.transactionId)).toBeNull();
    const { data } = await admin.from('deal_commissions').select('id').in('transaction_id', [dealBare.transactionId, dealOut.transactionId]);
    expect(data).toEqual([]);
  });

  it('is made the first time the owner or the agent opens a deal that has none, and shows terms and no amounts', async () => {
    const asAgent = d(await forDeal(agent, dealB.transactionId));
    expect(asAgent.role).toBe('agent');
    expect(asAgent.commission).toMatchObject({ status: 'estimate', grossStatus: 'estimate', gross: null, agentNet: null });
    expect(asAgent.terms?.split).toEqual({ type: 'percent', value: 70 });
    const asOwner = d(await forDeal(broker, dealC.transactionId));
    expect(asOwner.role).toBe('owner');
    expect(asOwner.commission?.grossStatus).toBe('estimate');
    expect(asOwner.terms?.fees).toHaveLength(2);
    // an agent with no terms: a note for them, nothing for the owner to confirm, and no row
    const noTermsAgent = d(await forDeal(bare, dealBare.transactionId));
    expect(noTermsAgent.awaitingTerms).toBe(true);
    expect(noTermsAgent.commission).toBeNull();
    expect(d(await forDeal(broker, dealBare.transactionId)).commission).toBeNull();
    // someone outside the brokerage sees nothing
    expect(d(await forDeal(outsider, dealA.transactionId)).role).toBeNull();
    expect(d(await forDeal(otherBroker, dealA.transactionId)).role).toBeNull();
  });

  it('cannot be agreed to, approved, paid or downloaded as a statement while it is an estimate', async () => {
    const id = v(await forDeal(agent, dealA.transactionId).then((r) => ({ json: (r.json as Deal1).commission }))).id;
    expect((await act(agent, id, { action: 'accept' })).status).toBe(409);
    expect((await act(agent, id, { action: 'request_change' })).status).toBe(400);
    expect((await act(broker, id, { action: 'approve' })).status).toBe(409);
    expect((await act(broker, id, { action: 'mark_paid' })).status).toBe(409);
    expect((await pdf(agent, id)).status).toBe(409);
    expect((await pdf(broker, id)).status).toBe(409);
  });

  it('lets the agent flag something without changing it, and tells the owner', async () => {
    const id = v({ json: (d(await forDeal(agent, dealA.transactionId))).commission }).id;
    const flagged = await act(agent, id, { action: 'request_change', note: 'My split is 75%, not 70%.' });
    expect(flagged.status, JSON.stringify(flagged.json)).toBe(200);
    expect(v(flagged)).toMatchObject({ status: 'estimate', changeNote: 'My split is 75%, not 70%.' });
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', broker.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.some((b) => /flagged something on the estimate/.test(String(b.title)))).toBe(true);
  });
});

describe('commission only exists once the deal has closed', () => {
  it('shows nothing and makes nothing on a deal that is still open', async () => {
    expect(await ensureEstimateStatement(dealOpen.transactionId)).toBeNull();
    expect(d(await forDeal(agent, dealOpen.transactionId)).commission).toBeNull();
    const asOwner = d(await forDeal(broker, dealOpen.transactionId));
    expect(asOwner.commission).toBeNull();
    expect((await post(broker, { transactionId: dealOpen.transactionId, splitType: 'percent', splitValue: 70 })).status).toBe(409);
    expect((await post(broker, { transactionId: dealOpen.transactionId, gross: 10000 })).status).toBe(409);
    const { data } = await admin.from('deal_commissions').select('id').eq('transaction_id', dealOpen.transactionId);
    expect(data).toEqual([]);
  });
  it('an estimate left on an open deal is hidden everywhere until it closes', async () => {
    await admin.from('deal_commissions').insert({ transaction_id: dealOpen.transactionId, owner_user_id: broker.id, agent_user_id: agent.id, statement_number: 'COMM-0991', gross_cents: null, split_type: 'percent', split_value: 70, deductions: [], status: 'estimate' });
    expect(d(await forDeal(agent, dealOpen.transactionId)).commission).toBeNull();
    expect(d(await forDeal(broker, dealOpen.transactionId)).commission).toBeNull();
    const ledger = (await call(h(GET), broker, { method: 'GET', path: '/api/commissions' })).json as { asOwner: { transactionId: string }[] };
    expect(ledger.asOwner.some((r) => r.transactionId === dealOpen.transactionId)).toBe(false);
    await admin.from('deal_commissions').delete().eq('transaction_id', dealOpen.transactionId);
  });
  it('closing makes the statement with the expected gross from the sale price and the agent’s rate', async () => {
    await admin.from('transactions').update({ status: 'Closed' }).eq('id', dealOpen.transactionId);
    const made = await ensureEstimateStatement(dealOpen.transactionId);
    expect(made).toMatchObject({ status: 'estimate', commission_type: 'percent', estimated_gross_cents: 1_500_000 });
    const view = d(await forDeal(broker, dealOpen.transactionId)).commission as unknown as { rate: { type: string; value: number }; estimate: { gross: number; agentNet: number } };
    expect(view.rate).toEqual({ type: 'percent', value: 3 });
    // 3% of 500,000 = 15,000; at the 70% split = 10,500, less 495 in fees = 10,005 to the agent
    expect(view.estimate).toMatchObject({ gross: 15000, agentNet: 10005 });
  });
  it('the rate can be a flat fee and can be changed for one deal', async () => {
    const res = await post(broker, { transactionId: dealOpen.transactionId, commissionType: 'flat', commissionValue: 4500, splitType: 'percent', splitValue: 70 });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const row = (await admin.from('deal_commissions').select('commission_type, commission_value, estimated_gross_cents').eq('transaction_id', dealOpen.transactionId).single()).data;
    expect(row).toMatchObject({ commission_type: 'flat', commission_value: 4500, estimated_gross_cents: 450_000 });
    expect((await post(broker, { transactionId: dealOpen.transactionId, commissionType: 'percent', commissionValue: 120, splitType: 'percent', splitValue: 70 })).status).toBe(400);
    // the agent's base rate is untouched by a change on one deal
    const base = (await admin.from('brokerage_links').select('default_commission_type, default_commission_value').eq('id', linkId).single()).data;
    expect(base).toMatchObject({ default_commission_type: 'percent', default_commission_value: 3 });
  });
});

describe('the owner confirms the actual commission', () => {
  it('the agent cannot confirm amounts or save terms on a deal', async () => {
    expect((await post(agent, { transactionId: dealA.transactionId, gross: 10000 })).status).toBe(403);
    expect((await post(null, { transactionId: dealA.transactionId, gross: 10000 })).status).toBe(401);
    expect((await post(otherBroker, { transactionId: dealA.transactionId, gross: 10000 })).status).toBe(404);
  });

  it('terms can be changed for one deal and it stays an estimate', async () => {
    const res = await post(broker, { transactionId: dealA.transactionId, splitType: 'percent', splitValue: 75 });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(v(res)).toMatchObject({ status: 'estimate', gross: null, splitValue: 75, changeNote: null });
    const bad = await post(broker, { transactionId: dealA.transactionId, splitType: 'percent', splitValue: 150 });
    expect(bad.status).toBe(400);
  });

  it('a gross confirms it: amounts are worked out, who confirmed is recorded, and the agent is told', async () => {
    const res = await post(broker, { transactionId: dealA.transactionId, gross: 10000 });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    // 75% of 10,000 = 7,500, less 395 and 100 in fees = 7,005 to the agent; the brokerage keeps 2,500 + 495
    expect(v(res)).toMatchObject({ status: 'proposed', grossStatus: 'confirmed', gross: 10000, agentNet: 7005, brokerageNet: 2995, changeNote: null });
    expect(v(res).confirmedAt).toBeTruthy();
    const { data } = await admin.from('deal_commissions').select('confirmed_by, cap_snapshot').eq('transaction_id', dealA.transactionId).single();
    expect(data!.confirmed_by).toBe(broker.id);
    expect(data!.cap_snapshot).toMatchObject({ capCents: 1_000_000 });
    const bell = (await admin.from('notifications').select('title').eq('recipient_user_id', agent.id).eq('event_type', 'commission')).data ?? [];
    expect(bell.some((b) => /confirmed the commission statement/.test(String(b.title)))).toBe(true);
    expect((await pdf(agent, v(res).id)).status).toBe(200);
  });

  it('then the agent reviews it, but cannot record payment', async () => {
    const id = v({ json: d(await forDeal(agent, dealA.transactionId)).commission }).id;
    expect((await act(agent, id, { action: 'mark_paid' })).status).toBe(400);
    expect(v(await act(agent, id, { action: 'accept' })).status).toBe('accepted');
    expect((await post(broker, { transactionId: dealA.transactionId, splitType: 'percent', splitValue: 75 })).status).toBe(400); // a confirmed statement needs a gross to change
    expect(v(await act(broker, id, { action: 'mark_paid', paidOn: new Date().toISOString().slice(0, 10) })).status).toBe('paid');
  });

  it('an owner can start a statement by hand when the agent had no terms', async () => {
    const res = await post(broker, { transactionId: dealBare.transactionId, splitType: 'percent', splitValue: 80 });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(v(res)).toMatchObject({ status: 'estimate', gross: null, splitValue: 80 });
    expect(v(res).deductions).toEqual([]);
  });
});

describe('the cap is shown and warns, and changes no split', () => {
  it('counts the brokerage’s share on confirmed statements in the period', async () => {
    // dealA is confirmed at 10,000 with a 25% brokerage share = 2,500 of a 10,000 cap
    let cap = d(await forDeal(broker, dealB.transactionId)).cap!;
    expect(cap).toMatchObject({ state: 'ok', usedCents: 250_000, percent: 25 });
    // dealB at 30,000 (share 7,500 at 75%... uses the deal's own 70% split: 9,000) takes them to 11,500: over the cap
    const { data: b } = await admin.from('deal_commissions').select('id').eq('transaction_id', dealB.transactionId).single();
    expect(b).toBeTruthy();
    await post(broker, { transactionId: dealB.transactionId, gross: 20000 }); // 30% of 20,000 = 6,000 -> 8,500 of 10,000
    cap = d(await forDeal(agent, dealC.transactionId)).cap!;
    expect(cap).toMatchObject({ state: 'near', usedCents: 850_000, percent: 85 });
    await post(broker, { transactionId: dealC.transactionId, gross: 10000 }); // +3,000 -> 11,500
    cap = d(await forDeal(broker, dealC.transactionId)).cap!;
    expect(cap.state).toBe('reached');
    expect(cap.percent).toBe(100);
    // the split on the next deal is not touched by reaching the cap
    const next = d(await forDeal(agent, dealD.transactionId));
    expect(next.commission).toMatchObject({ status: 'estimate', splitValue: 70 });
  });
});

describe('statements that already existed', () => {
  it('stay as they were: status, figures and payment history', async () => {
    const seeded = await seedDeal(agent, 'CEOLD');
    const row = { transaction_id: seeded.transactionId, owner_user_id: broker.id, agent_user_id: agent.id, statement_number: 'COMM-0990', gross_cents: 500_000, split_type: 'percent', split_value: 80, deductions: [], agent_net_cents: 400_000, brokerage_net_cents: 100_000 };
    await admin.from('deal_commissions').insert({ ...row, status: 'accepted', accepted_at: '2026-01-02T00:00:00Z' });
    const open = d(await forDeal(agent, seeded.transactionId)).commission!;
    expect(open).toMatchObject({ status: 'accepted', grossStatus: 'confirmed', gross: 5000, agentNet: 4000 });
    const asOwner = d(await forDeal(broker, seeded.transactionId)).commission!;
    expect(asOwner.status).toBe('accepted');
    expect(v(await act(broker, asOwner.id, { action: 'mark_paid', paidOn: '2026-02-01' })).status).toBe('paid');
    expect((await ensureEstimateStatement(seeded.transactionId))!.status).toBe('paid');
  });
});
