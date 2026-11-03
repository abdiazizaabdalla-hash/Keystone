import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as onboard } from '@/app/api/agent-onboarding/route';
import { GET as listPins } from '@/app/api/templates/pins/route';
import { admin, call, cleanup, createActor, type Actor } from './helpers';

// New paid agents say which states they work in during setup. Nothing is assumed: only what they tick is saved.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let agent: Actor;
let agent2: Actor;

beforeAll(async () => {
  agent = await createActor('ob-agent', { role: 'agent', agent_workspace: true });
  agent2 = await createActor('ob-agent2', { role: 'agent', agent_workspace: true });
});
afterAll(cleanup);

const finish = (who: Actor, body: Record<string, unknown>) => call(h(onboard), who, { method: 'POST', path: '/api/agent-onboarding', body: { mode: 'self', name: 'Pat Agent', ...body } });
const pins = async (who: Actor) => (await call(h(listPins), who, { method: 'GET', path: '/api/templates/pins' })).json as Array<{ kind: string; ref: string }>;

describe('agent setup: states you work in', () => {
  it('saves only the states they ticked, ignores nonsense, and never fails the setup', async () => {
    const res = await finish(agent, { states: ['CO', 'OK', 'co', 'ZZ', 'every', 42, 'CO'] });
    expect(res.status).toBe(200);
    expect((await pins(agent)).map((p) => `${p.kind}:${p.ref}`).sort()).toEqual(['folder:CO', 'folder:OK']);
    // running setup twice does not duplicate or add anything
    expect((await finish(agent, { states: ['CO'] })).status).toBe(200);
    expect((await pins(agent)).length).toBe(2);
  });

  it('assumes nothing when no state is chosen', async () => {
    expect((await finish(agent2, {})).status).toBe(200);
    expect(await pins(agent2)).toHaveLength(0);
    const { data } = await admin.from('template_pins').select('id').eq('owner_user_id', agent2.id);
    expect(data).toHaveLength(0);
  });
});
