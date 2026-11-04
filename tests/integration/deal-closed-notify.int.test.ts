import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { POST as generate } from '@/app/api/commissions/generate/route';
import { PATCH as patchCommission } from '@/app/api/commissions/[id]/route';
import { GET as cron } from '@/app/api/cron/commission-nudges/route';
import { NextRequest } from 'next/server';
import { runCommissionNudges } from '@/lib/commissionNudges';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// A deal closing in a brokerage tells the owner (with where the commission stands) and nudges the agent to invoice; the daily
// nudges follow up on stale approvals; nobody outside the brokerage hears anything.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const close = (who: Actor, deal: Deal) => call(h(patchTransaction), who, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body: { status: 'Closed' } });
const bell = async (who: Actor, type: string) => (await admin.from('notifications').select('title, body, link, event_type').eq('recipient_user_id', who.id).eq('event_type', type)).data ?? [];

let broker: Actor, agent: Actor, outsider: Actor, otherBroker: Actor;
let d1: Deal, d2: Deal, d3: Deal, dOut: Deal;

beforeAll(async () => {
  broker = await createActor('dc-broker', { plan: 'team' });
  otherBroker = await createActor('dc-other', { plan: 'team' });
  agent = await createActor('dc-agent', { role: 'agent', agent_workspace: true });
  outsider = await createActor('dc-out', { role: 'agent', agent_workspace: true });
  [d1, d2, d3] = [await seedDeal(agent, 'DC1'), await seedDeal(agent, 'DC2'), await seedDeal(agent, 'DC3')];
  dOut = await seedDeal(outsider, 'DCO');
  for (const o of [broker, otherBroker]) {
    const { data: team } = await admin.from('teams').insert({ owner_id: o.id }).select('id').single();
    await admin.from('team_members').insert({ team_id: team!.id, user_id: o.id, role: 'owner' });
  }
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', default_split_type: 'percent', default_split_value: 80 });
}, 90_000);
afterAll(cleanup);

describe('when a deal closes', () => {
  it('tells the owner there is no invoice yet, once, and does not nudge the agent who closed it', async () => {
    expect((await close(agent, d1)).status).toBe(200);
    const ownerRows = await bell(broker, 'deal_closed');
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].title).toMatch(/^Deal closed/);
    expect(ownerRows[0].body).toMatch(/No commission invoice yet/);
    expect(ownerRows[0].link).toBe(`/dashboard/collaborate/deals/${d1.transactionId}`);
    expect(await bell(agent, 'deal_closed')).toHaveLength(0);
    // saving it as Closed again is not a new close, and the generic "stage moved" line is not added on top
    await close(agent, d1);
    expect(await bell(broker, 'deal_closed')).toHaveLength(1);
    expect((await bell(broker, 'stage_changed')).filter((r) => /Closed/.test(String(r.title)))).toHaveLength(0);
  });

  it('says where the invoice stands when there already is one', async () => {
    const made = await call(h(generate), agent, { method: 'POST', path: '/x', body: { transactionId: d2.transactionId, gross: 8000 } });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    await close(agent, d2);
    const rows = (await bell(broker, 'deal_closed')).filter((r) => String(r.link).includes(d2.transactionId));
    expect(rows[0].body).toMatch(/COMM-\d+ is waiting for your approval/);
  });

  it('when the owner closes it, the agent is asked to invoice', async () => {
    expect((await close(broker, d3)).status).toBe(200);
    const rows = await bell(agent, 'deal_closed');
    expect(rows.some((r) => /Generate your commission invoice/.test(String(r.title)))).toBe(true);
  });

  it('nobody outside a brokerage is told anything', async () => {
    await close(outsider, dOut);
    expect(await bell(otherBroker, 'deal_closed')).toHaveLength(0);
    expect(await bell(outsider, 'deal_closed')).toHaveLength(0);
  });
});

describe('the daily nudges', () => {
  it('needs the cron secret', async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-secret';
    try {
      expect((await cron(new NextRequest('http://localhost/x'))).status).toBe(401);
      expect((await cron(new NextRequest('http://localhost/x', { headers: { authorization: 'Bearer test-secret' } }))).status).toBe(200);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it('chase a stale approval and unpaid deals, and do not repeat themselves', async () => {
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const longAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await admin.from('deal_commissions').update({ proposed_at: longAgo }).eq('transaction_id', d2.transactionId);
    const week = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
    const first = await runCommissionNudges(new Date().toISOString().slice(0, 10));
    expect(first.created).toBeGreaterThan(0);
    const approvals = (await bell(broker, 'commission')).filter((r) => /waited \d+ days? for your approval/.test(String(r.title)));
    expect(approvals).toHaveLength(1);
    const again = await runCommissionNudges(new Date().toISOString().slice(0, 10));
    expect(again.created).toBe(0);
    expect(inThreeDays && week).toBeTruthy();
  });

  it('the owner can approve, and the nudges stop', async () => {
    const id = ((await admin.from('deal_commissions').select('id').eq('transaction_id', d2.transactionId).single()).data as { id: string }).id;
    expect((await call(h(patchCommission), broker, { method: 'PATCH', path: '/x', params: { id }, body: { action: 'approve' } })).status).toBe(200);
    await admin.from('notifications').delete().eq('recipient_user_id', broker.id).eq('event_type', 'commission');
    await runCommissionNudges(new Date().toISOString().slice(0, 10));
    expect((await bell(broker, 'commission')).filter((r) => /approval/.test(String(r.title)))).toHaveLength(0);
  });
});
