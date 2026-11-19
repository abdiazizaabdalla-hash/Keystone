import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getPause, PUT as putPause } from '@/app/api/automation/pause/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { AUTOMATION_PLAN_MESSAGE } from '@/lib/automation/plan';
import { call, cleanup, createActor, type Actor } from './helpers';

// The Automation block in Settings: Pro and Team get the account-wide on/off switch; Starter is told to upgrade and
// the server refuses every automation route for them. The screen reads `automationAllowed` from /api/auth/me.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let starter: Actor;
let pro: Actor;
beforeAll(async () => {
  starter = await createActor('ap-starter', { plan: 'starter' });
  pro = await createActor('ap-pro', { plan: 'pro' });
});
afterAll(cleanup);

describe('automation on/off switch (Settings)', () => {
  it('a Pro account reads it, switches it off and on, and the state sticks', async () => {
    expect((await call(h(getPause), pro, { method: 'GET', path: '/api/automation/pause' })).json).toEqual({ paused: false });
    expect((await call(h(putPause), pro, { method: 'PUT', path: '/api/automation/pause', body: { paused: true } })).json).toEqual({ paused: true });
    expect((await call(h(getPause), pro, { method: 'GET', path: '/api/automation/pause' })).json).toEqual({ paused: true });
    expect((await call(h(putPause), pro, { method: 'PUT', path: '/api/automation/pause', body: { paused: false } })).json).toEqual({ paused: false });
    expect((await call(h(getPause), pro, { method: 'GET', path: '/api/automation/pause' })).json).toEqual({ paused: false });
  });

  it('rejects a bad value', async () => {
    expect((await call(h(putPause), pro, { method: 'PUT', path: '/api/automation/pause', body: { paused: 'yes' } })).status).toBe(400);
  });

  it('a Starter account is refused with the upgrade message, and the screen is told it is not allowed', async () => {
    const get = await call(h(getPause), starter, { method: 'GET', path: '/api/automation/pause' });
    expect(get.status).toBe(403);
    expect((get.json as { error: string }).error).toBe(AUTOMATION_PLAN_MESSAGE);
    expect((await call(h(putPause), starter, { method: 'PUT', path: '/api/automation/pause', body: { paused: true } })).status).toBe(403);
    expect(((await call(h(authMe), starter, { method: 'GET', path: '/api/auth/me' })).json as { automationAllowed: boolean }).automationAllowed).toBe(false);
    expect(((await call(h(authMe), pro, { method: 'GET', path: '/api/auth/me' })).json as { automationAllowed: boolean }).automationAllowed).toBe(true);
  });
});
