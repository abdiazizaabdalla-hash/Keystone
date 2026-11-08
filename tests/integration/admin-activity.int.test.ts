import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/admin/activity/route';
import { call, cleanup, createActor, seedDeal, type Actor } from './helpers';

let tc: Actor;
let boss: Actor;
type Handler = Parameters<typeof call>[0];
const get = (who: Actor | null, path = '/api/admin/activity') => call(GET as unknown as Handler, who, { method: 'GET', path });

beforeAll(async () => {
  tc = await createActor('act-tc', { plan: 'starter' });
  boss = await createActor('act-boss', { is_admin: true });
  await seedDeal(tc, 'ACT');
}, 90_000);
afterAll(cleanup);

describe('admin activity', () => {
  it('is admin-only', async () => {
    expect((await get(tc)).status).toBe(403);
  });
  it('reports last real activity and counts for a coordinator', async () => {
    const res = await get(boss);
    expect(res.status).toBe(200);
    const row = ((res.json as { users: unknown }).users as { id: string; deals: number; lastActiveAt: string | null }[]).find((u) => u.id === tc.id);
    expect(row?.deals).toBe(1);
    expect(row?.lastActiveAt).toBeTruthy();
  });
});
