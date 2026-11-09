import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getActivity } from '@/app/api/automation/activity/route';
import { PUT as putSettings } from '@/app/api/automation/settings/route';
import { PUT as putPause } from '@/app/api/automation/pause/route';
import { GET as getApprovals } from '@/app/api/automation/approvals/route';
import { POST as decide } from '@/app/api/automation/actions/[id]/decide/route';
import { submitAutomationAction } from '@/lib/automation/actions';
import { runTick } from '@/lib/automation/tick';
import { admin, call, cleanup, createActor, createCollaborator, addCollaboratorToDeal, seedDeal, type Actor, type Deal } from './helpers';

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
let tc: Actor, other: Actor, collab: Actor;
let d1: Deal, dOther: Deal;
const withFlags = process.env.RELAY_FEATURES;

const activity = (who: Actor, d: Deal) => call(h(getActivity), who, { method: 'GET', path: `/api/automation/activity?transactionId=${d.transactionId}` });
const mode = (who: Actor, d: Deal, m: string) => call(h(putSettings), who, { method: 'PUT', path: '/api/automation/settings', body: { transactionId: d.transactionId, mode: m } });

beforeAll(async () => {
  tc = await createActor('aui-tc');
  other = await createActor('aui-other');
  collab = await createCollaborator('aui-collab');
  d1 = await seedDeal(tc, 'AUI1');
  dOther = await seedDeal(other, 'AUIO');
  await addCollaboratorToDeal(d1, collab, tc);
}, 90_000);
afterAll(async () => {
  process.env.RELAY_FEATURES = withFlags;
  await cleanup();
});

describe('assistant routes', () => {
  it('saves a setting, reads it back, and can switch it again', async () => {
    expect((await mode(tc, d1, 'draft')).status).toBe(200);
    expect(((await activity(tc, d1)).json as { settings: { mode: string } }).settings.mode).toBe('draft');
    expect((await mode(tc, d1, 'auto')).status).toBe(200);
    expect(((await activity(tc, d1)).json as { settings: { mode: string } }).settings.mode).toBe('auto');
    expect((await mode(tc, d1, 'bogus')).status).toBe(400);
  });

  it("another account cannot read or change someone else's deal", async () => {
    expect([403, 404]).toContain((await activity(other, d1)).status);
    expect([403, 404]).toContain((await mode(other, d1, 'auto')).status);
  });

  it('a collaborator is refused', async () => {
    expect((await mode(collab, d1, 'auto')).status).toBe(403);
  });

  it('looks like it does not exist when the flag is off', async () => {
    const saved = process.env.RELAY_FEATURES;
    process.env.RELAY_FEATURES = 'agent_workspace';
    expect((await activity(tc, d1)).status).toBe(404);
    process.env.RELAY_FEATURES = saved;
  });

  it('a draft can be listed, edited and approved, or rejected; only its owner can decide', async () => {
    await mode(tc, d1, 'draft');
    const out = await submitAutomationAction({ ownerUserId: tc.id, transactionId: d1.transactionId, kind: 'set_date', inputs: { field: 'closing_date', date: '2027-01-10' }, idempotencyKey: `aui:note:${d1.marker}` });
    expect(out.status).toBe('awaiting_approval');
    const list = (await call(h(getApprovals), tc, { method: 'GET', path: '/api/automation/approvals' })).json as { approvals: { actionId: string }[] };
    expect(list.approvals.some((a) => a.actionId === out.actionId)).toBe(true);
    const path = `/api/automation/actions/${out.actionId}/decide`;
    expect([403, 404]).toContain((await call(h(decide), other, { method: 'POST', path, body: { decision: 'approve' }, params: { id: out.actionId } })).status);
    const ok = await call(h(decide), tc, { method: 'POST', path, body: { decision: 'approve', edited: { date: '2027-01-12' } }, params: { id: out.actionId } });
    expect(ok.status).toBe(200);
    expect((await admin.from('automation_actions').select('status, inputs').eq('id', out.actionId!).single()).data).toMatchObject({ status: 'executed', inputs: { date: '2027-01-12' } });

    const out2 = await submitAutomationAction({ ownerUserId: tc.id, transactionId: d1.transactionId, kind: 'set_date', inputs: { field: 'closing_date', date: '2027-02-01' }, idempotencyKey: `aui:note2:${d1.marker}` });
    const rej = await call(h(decide), tc, { method: 'POST', path: `/api/automation/actions/${out2.actionId}/decide`, body: { decision: 'reject' }, params: { id: out2.actionId } });
    expect(rej.status).toBe(200);
    expect((await admin.from('automation_actions').select('status').eq('id', out2.actionId!).single()).data?.status).toBe('cancelled');
  });

  it('the kill switch stops new work', async () => {
    expect((await call(h(putPause), tc, { method: 'PUT', path: '/api/automation/pause', body: { paused: true } })).status).toBe(200);
    const out = await submitAutomationAction({ ownerUserId: tc.id, transactionId: d1.transactionId, kind: 'add_note', inputs: { text: 'x' }, idempotencyKey: `aui:paused:${d1.marker}` });
    expect(out.status).toBe('refused');
    await call(h(putPause), tc, { method: 'PUT', path: '/api/automation/pause', body: { paused: false } });
  });
});

describe('runner', () => {
  it('runs without error, is repeatable, and does not touch accounts that have the assistant off', async () => {
    await mode(tc, d1, 'draft');
    const a = await runTick();
    const b = await runTick();
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    const { data } = await admin.from('automation_actions').select('id').eq('transaction_id', dOther.transactionId);
    expect(data ?? []).toHaveLength(0);
  }, 60_000);
});
