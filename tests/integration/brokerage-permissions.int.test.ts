import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as dealView } from '@/app/api/oversight/deals/[id]/view/route';
import { GET as myBrokerage } from '@/app/api/brokerage/route';
import { PATCH as answer } from '@/app/api/brokerage/[id]/route';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// The agent decides whether their brokerage can open document files. Skipped when add-brokerage-permissions.sql has not been run on this database.
type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let broker: Actor;
let agent: Actor;
let outsider: Actor;
let deal: Deal;
let linkId = '';
let columnThere = false;

beforeAll(async () => {
  broker = await createActor('bp-broker', { plan: 'team' });
  agent = await createActor('bp-agent', { role: 'agent', agent_workspace: true });
  outsider = await createActor('bp-out', { plan: 'team' });
  deal = await seedDeal(agent, 'BPA');
  const { data } = await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active' }).select('id').single();
  linkId = data!.id as string;
  columnThere = !(await admin.from('brokerage_links').select('can_open_documents').limit(1)).error;
  await admin.from('documents').insert({ transaction_id: deal.transactionId, file_name: 'contract.pdf', storage_path: `bp/${deal.transactionId}/contract.pdf`, content_type: 'application/pdf', file_size: 10 });
}, 90_000);
afterAll(cleanup);

const view = (who: Actor) => call(h(dealView), who, { method: 'GET', path: '/x', params: { id: deal.transactionId } });

describe('document file access', () => {
  it('is on by default: the owner gets links to the files', async () => {
    const res = await view(broker);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const body = res.json as { documents: { file_name: string; url: string | null }[]; documentsLocked: boolean };
    expect(body.documentsLocked).toBe(false);
    expect(body.documents.map((d) => d.file_name)).toContain('contract.pdf');
  });
  it('another brokerage cannot open it at all', async () => {
    expect((await view(outsider)).status).toBe(404);
  });
  it.runIf(true)('the agent can switch file access off and the owner then sees names only', async () => {
    if (!columnThere) return;
    const off = await call(h(answer), agent, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'set_permissions', canOpenDocuments: false } });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    const mine = await call(h(myBrokerage), agent, { method: 'GET', path: '/api/brokerage' });
    expect((mine.json as { current: { canOpenDocuments: boolean } }).current.canOpenDocuments).toBe(false);
    const res = await view(broker);
    const body = res.json as { documents: { url: string | null }[]; documentsLocked: boolean };
    expect(body.documentsLocked).toBe(true);
    expect(body.documents.every((d) => d.url === null)).toBe(true);
    const on = await call(h(answer), agent, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'set_permissions', canOpenDocuments: true } });
    expect(on.status).toBe(200);
    expect(((await view(broker)).json as { documentsLocked: boolean }).documentsLocked).toBe(false);
  });
  it('only the agent on the link can change it', async () => {
    if (!columnThere) return;
    const res = await call(h(answer), outsider, { method: 'PATCH', path: '/x', params: { id: linkId }, body: { action: 'set_permissions', canOpenDocuments: false } });
    expect([403, 404]).toContain(res.status);
  });
});
