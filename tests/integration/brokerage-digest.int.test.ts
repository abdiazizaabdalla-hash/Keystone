import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as cron } from '@/app/api/cron/brokerage-digest/route';
import { runBrokerageDigest } from '@/lib/brokerageDigest';
import { admin, cleanup, createActor, seedDeal, type Actor } from './helpers';

// The weekly broker email: one per owner who has agents, a line per agent, nothing for owners without agents.

let broker: Actor, lonely: Actor, agent: Actor;

beforeAll(async () => {
  broker = await createActor('dg-broker', { plan: 'team' });
  lonely = await createActor('dg-lonely', { plan: 'team' });
  agent = await createActor('dg-agent', { role: 'agent', agent_workspace: true });
  await seedDeal(agent, 'DG1');
  await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' });
}, 60_000);
afterAll(cleanup);

describe('weekly broker digest', () => {
  it('needs the cron secret', async () => {
    expect((await cron(new NextRequest('http://localhost/api/cron/brokerage-digest'))).status).toBe(401);
  });

  it('emails each owner who has agents, with a line per agent, and nobody else', async () => {
    const result = await runBrokerageDigest(new Date().toISOString().slice(0, 10));
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const mine = (await admin.from('email_outbox').select('to_emails, subject, body').eq('source', 'brokerage_digest').eq('owner_user_id', broker.id)).data ?? [];
    expect(mine).toHaveLength(1);
    expect(mine[0].to_emails as string[]).toContain(broker.email);
    expect(mine[0].body as string).toMatch(/open deal/);
    expect(((await admin.from('email_outbox').select('id').eq('source', 'brokerage_digest').eq('owner_user_id', lonely.id)).data ?? []).length).toBe(0);
  });
});
