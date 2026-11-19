import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as report } from '@/app/api/oversight/compliance-report/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// The broker's compliance snapshot: every active agent and the stage of each file, as a CSV or a PDF. Owners only.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const get = (who: Actor | null, format: string) => call(h(report), who, { method: 'GET', path: `/api/oversight/compliance-report?format=${format}` });
// The CSV and PDF are not JSON, so read the response itself.
const raw = (who: Actor, format: string) => (report as unknown as (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>)(new NextRequest(`http://localhost/api/oversight/compliance-report?format=${format}`, { headers: { authorization: `Bearer ${who.token}` } }), { params: Promise.resolve({}) });

let broker: Actor, agent: Actor, stranger: Actor, strangerAgent: Actor;
let deal: Deal, hidden: Deal;

beforeAll(async () => {
  broker = await createActor('cr-broker', { plan: 'team' });
  agent = await createActor('cr-agent', { role: 'agent', agent_workspace: true });
  stranger = await createActor('cr-stranger', { plan: 'team' });
  strangerAgent = await createActor('cr-sagent', { role: 'agent', agent_workspace: true });
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' });
  await admin.from('brokerage_links').insert({ owner_user_id: stranger.id, agent_user_id: strangerAgent.id, invited_email: strangerAgent.email, status: 'active' });
  deal = await seedDeal(agent, 'CR1');
  hidden = await seedDeal(strangerAgent, 'CR2');
  await admin.from('transactions').update({ property_address: '12 Report Rd, Austin, TX', purchase_price: 350000, status: 'Under Contract' }).eq('id', deal.transactionId);
  await admin.from('transactions').update({ property_address: '99 Hidden St, Austin, TX' }).eq('id', hidden.transactionId);
  await admin.from('brokerage_file_requirements').upsert({ owner_user_id: broker.id, document_types: ['Purchase Contract'] });
}, 60_000);
afterAll(cleanup);

describe('compliance report', () => {
  it('is for brokerage owners only', async () => {
    expect((await get(null, 'csv')).status).toBe(401);
    expect((await get(agent, 'csv')).status).toBe(403);
  });

  it('the CSV lists each agent and each file with its stage and what is missing, and nobody else’s', async () => {
    const res = await raw(broker, 'csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('Agent summary');
    expect(text).toContain('12 Report Rd');
    expect(text).toContain('Under Contract');
    expect(text).toContain('Purchase Contract');
    expect(text).not.toContain('99 Hidden');
  });

  it('the PDF is a PDF', async () => {
    const res = await raw(broker, 'pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
  });
});
