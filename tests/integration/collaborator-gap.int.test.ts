import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listAgents, POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { POST as sendDirectMessage } from '@/app/api/direct-messages/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// A free agent (an invited collaborator) can work on deals a paying coordinator
// added them to, but cannot create work in a workspace of their own.

let tcA: Actor;
let tcB: Actor;
let collaborator: Actor;

const newAgent = (name: string) => ({ name, email: `${name.toLowerCase().replace(/\s+/g, '')}@example.test`, flatFee: 0, percentFee: 0 });

beforeAll(async () => {
  tcA = await createActor('tc-a');
  tcB = await createActor('tc-b');
  collaborator = await createCollaborator('collab');
});

afterAll(async () => {
  await cleanup();
});

describe('free collaborator cannot create their own work', () => {
  it('a coordinator can still create an agent profile (nothing regressed)', async () => {
    const res = await call(createAgent, tcA, { method: 'POST', path: '/api/agents', body: newAgent('Owned By A') });
    expect(res.status).toBeLessThan(300);
  });

  it('rejects an agent profile created by a collaborator', async () => {
    const res = await call(createAgent, collaborator, { method: 'POST', path: '/api/agents', body: newAgent('Collab Made') });
    expect(res.status).toBe(403);
    const { count } = await admin.from('agents').select('id', { count: 'exact', head: true }).eq('tc_user_id', collaborator.id);
    expect(count).toBe(0);
  });

  it('rejects a transaction created by a collaborator, even with an agent profile of their own', async () => {
    // Insert the profile directly so the transaction attempt is not stopped by the missing agent.
    const { data: agent, error } = await admin
      .from('agents')
      .insert({ tc_user_id: collaborator.id, name: 'Seeded Agent', email: 'seeded@example.test', flat_fee: 0, commission_percent: 0 })
      .select('id')
      .single();
    expect(error).toBeNull();
    const res = await call(createTransaction, collaborator, {
      method: 'POST',
      path: '/api/transactions',
      body: { agentId: agent!.id, propertyAddress: '1 Test St', purchasePrice: 100000, fileNumber: 'IT-1' },
    });
    expect(res.status).toBe(403);
    const { count } = await admin.from('transactions').select('id', { count: 'exact', head: true }).eq('tc_user_id', collaborator.id);
    expect(count).toBe(0);
  });

  it('rejects calls with no sign-in', async () => {
    const res = await call(createAgent, null, { method: 'POST', path: '/api/agents', body: newAgent('Nobody') });
    expect(res.status).toBe(401);
  });

  it('still lets a collaborator reach the shared direct-messages route (the trial gate does not block them)', async () => {
    const res = await call(sendDirectMessage, collaborator, { method: 'POST', path: '/api/direct-messages', body: {} });
    const message = JSON.stringify(res.json ?? '');
    expect(message).not.toContain('Agent portal accounts');
    expect(res.status).not.toBe(402);
  });
});

describe('coordinators only see their own agents', () => {
  it("B's list does not contain A's agent", async () => {
    const res = await call(listAgents, tcB, { method: 'GET', path: '/api/agents' });
    expect(res.status).toBe(200);
    const names = (res.json as { name: string }[]).map((a) => a.name);
    expect(names).not.toContain('Owned By A');
  });

  it('A sees their own agent', async () => {
    const res = await call(listAgents, tcA, { method: 'GET', path: '/api/agents' });
    expect(res.status).toBe(200);
    const names = (res.json as { name: string }[]).map((a) => a.name);
    expect(names).toContain('Owned By A');
  });
});
