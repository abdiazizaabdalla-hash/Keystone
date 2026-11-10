import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route';
import { PATCH as toggleTask } from '@/app/api/tasks/route';
import { POST as uploadDocument } from '@/app/api/documents/route';
import { decideAutomationAction, submitAutomationAction } from '@/lib/automation/actions';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// Auto-0 against the real relay-test database: events are written by the real routes (once, scoped to the owner, nothing when the
// flag is off), and the action pipeline sends nothing twice, refuses what the guard refuses, and never lets another account act.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const patchDeal = (who: Actor, deal: Deal, body: unknown) => call(h(patchTransaction), who, { method: 'PATCH', path: `/api/transactions/x?id=${deal.transactionId}`, body });
const events = async (deal: Deal, type?: string) => {
  let q = admin.from('transaction_events').select('type, owner_user_id, payload').eq('transaction_id', deal.transactionId);
  if (type) q = q.eq('type', type);
  return (await q).data ?? [];
};
const agentEmail = (deal: Deal) => `${deal.marker.toLowerCase()}@example.test`;
// (automation_settings is unique per deal through a partial index, which PostgREST cannot use for on_conflict, so write it as delete + insert.)
const setMode = async (who: Actor, deal: Deal, mode: string) => {
  await admin.from('automation_settings').delete().eq('transaction_id', deal.transactionId);
  // Quiet hours are off (start = end) so these tests do not depend on the time of day.
  const { error } = await admin.from('automation_settings').insert({ owner_user_id: who.id, transaction_id: deal.transactionId, mode, quiet_start_hour: 0, quiet_end_hour: 0 });
  if (error) throw new Error(`setMode failed: ${error.message}`);
};
const outbox = async (who: Actor) => (await admin.from('email_outbox').select('source, to_emails').eq('owner_user_id', who.id).eq('source', 'automation')).data ?? [];

let tc: Actor, other: Actor;
let d1: Deal, d2: Deal, dOther: Deal;
const withFlags = process.env.RELAY_FEATURES;

beforeAll(async () => {
  tc = await createActor('au-tc');
  other = await createActor('au-other');
  [d1, d2, dOther] = [await seedDeal(tc, 'AU1'), await seedDeal(tc, 'AU2'), await seedDeal(other, 'AUO')];
}, 90_000);
afterAll(async () => {
  process.env.RELAY_FEATURES = withFlags;
  await cleanup();
});

describe('events written by the real routes', () => {
  it('closing a deal records one deal_closed event for its owner, and saving Closed again adds none', async () => {
    expect((await patchDeal(tc, d1, { status: 'Closed' })).status).toBe(200);
    expect((await patchDeal(tc, d1, { status: 'Closed' })).status).toBe(200);
    const rows = await events(d1, 'deal_closed');
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_user_id).toBe(tc.id);
  });

  it('changing dates records date_changed with the new dates; saving the same dates again adds none', async () => {
    await patchDeal(tc, d2, { closingDate: '2026-12-15' });
    await patchDeal(tc, d2, { closingDate: '2026-12-15' });
    const rows = await events(d2, 'date_changed');
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { closingDate: string }).closingDate).toBe('2026-12-15');
    await patchDeal(tc, d2, { closingDate: '2026-12-20' });
    expect(await events(d2, 'date_changed')).toHaveLength(2);
  });

  it('ticking a step records step_ticked', async () => {
    expect((await call(h(toggleTask), tc, { method: 'PATCH', path: '/api/tasks', body: { taskId: d2.taskId } })).status).toBe(200);
    const rows = await events(d2, 'step_ticked');
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { taskId: string }).taskId).toBe(d2.taskId);
  });

  it('uploading a Purchase Contract records document_added and contract_uploaded', async () => {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4 test'], 'contract.pdf', { type: 'application/pdf' }));
    form.set('transactionId', d2.transactionId);
    form.set('category', 'contract_disclosures');
    form.set('documentType', 'Purchase Contract');
    const res = await uploadDocument(new NextRequest('http://localhost/api/documents', { method: 'POST', headers: { authorization: `Bearer ${tc.token}` }, body: form }));
    expect(res.status).toBe(201);
    expect(await events(d2, 'document_added')).toHaveLength(1);
    expect(await events(d2, 'contract_uploaded')).toHaveLength(1);
  });

  it("one account's events never appear on another account's deal", async () => {
    await patchDeal(other, dOther, { status: 'Closed' });
    expect((await events(dOther, 'deal_closed')).every((r) => r.owner_user_id === other.id)).toBe(true);
    expect((await admin.from('transaction_events').select('id').eq('owner_user_id', tc.id).eq('transaction_id', dOther.transactionId)).data).toHaveLength(0);
  });

  it('records nothing at all when the automation flag is off, and the save still works', async () => {
    process.env.RELAY_FEATURES = (withFlags ?? '').split(',').filter((f) => f.trim() !== 'automation').join(',');
    const d = await seedDeal(tc, 'AUOFF');
    expect((await patchDeal(tc, d, { status: 'Closed', closingDate: '2026-12-01' })).status).toBe(200);
    expect(await events(d)).toHaveLength(0);
    process.env.RELAY_FEATURES = withFlags;
  });
});

describe('the action pipeline on the real database', () => {
  const mail = (deal: Deal, key: string, to = [agentEmail(deal)]) => ({ ownerUserId: tc.id, transactionId: deal.transactionId, kind: 'send_deal_email', inputs: { to, subject: 'Update', message: 'Hello' }, idempotencyKey: key });

  it('with no settings row (Off) everything is refused and nothing is sent', async () => {
    const out = await submitAutomationAction(mail(d1, 'au-off-1'));
    expect(out.status).toBe('refused');
    expect(await outbox(tc)).toHaveLength(0);
  });

  it('Draft mode queues an approval; replaying the same key adds nothing; approving sends once; a second approve does nothing', async () => {
    await setMode(tc, d1, 'draft');
    const queued = await submitAutomationAction(mail(d1, 'au-draft-1'));
    expect(queued.status).toBe('awaiting_approval');
    expect((await submitAutomationAction(mail(d1, 'au-draft-1'))).duplicate).toBe(true);
    expect((await admin.from('automation_approvals').select('id').eq('action_id', queued.actionId)).data).toHaveLength(1);
    expect(await outbox(tc)).toHaveLength(0);

    const approved = await decideAutomationAction(queued.actionId, tc.id);
    expect(approved).toMatchObject({ status: 'executed' });
    expect(await decideAutomationAction(queued.actionId, tc.id)).toEqual({ error: 'not_pending' });
    const sent = await outbox(tc);
    expect(sent).toHaveLength(1);
    expect(sent[0].to_emails).toEqual([agentEmail(d1)]);
  });

  it('another account cannot approve my action', async () => {
    const queued = await submitAutomationAction(mail(d1, 'au-draft-2'));
    expect(await decideAutomationAction(queued.actionId, other.id)).toEqual({ error: 'not_owner' });
    expect((await admin.from('automation_actions').select('status').eq('id', queued.actionId).single()).data?.status).toBe('awaiting_approval');
  });

  it('refuses a recipient who is not on the deal', async () => {
    const out = await submitAutomationAction(mail(d1, 'au-stranger-1', ['stranger@example.test']));
    expect(out.status).toBe('refused');
  });

  it("refuses to act on another account's deal even with a settings row there", async () => {
    await setMode(tc, dOther, 'auto');
    const out = await submitAutomationAction({ ...mail(dOther, 'au-cross-1', [agentEmail(dOther)]), fromApprovedTemplate: true });
    expect(out.status).toBe('refused');
    expect(await outbox(tc)).toHaveLength(1); // still just the one approved email from above
  });

  it('the per-account kill switch stops the pipeline, and approval rechecks it', async () => {
    const queued = await submitAutomationAction(mail(d1, 'au-kill-1'));
    expect(queued.status).toBe('awaiting_approval');
    await admin.from('automation_account_controls').upsert({ owner_user_id: tc.id, paused: true });
    expect(await decideAutomationAction(queued.actionId, tc.id)).toMatchObject({ status: 'refused' });
    expect((await submitAutomationAction({ ownerUserId: tc.id, transactionId: d1.transactionId, kind: 'create_task', inputs: { name: 'x' }, idempotencyKey: 'au-kill-2' })).status).toBe('refused');
    expect(await outbox(tc)).toHaveLength(1);
    await admin.from('automation_account_controls').upsert({ owner_user_id: tc.id, paused: false });
  });

  it('create_task adds a task to the deal, and only once per key', async () => {
    const req = { ownerUserId: tc.id, transactionId: d1.transactionId, kind: 'create_task', inputs: { name: 'Chase the title company' }, idempotencyKey: 'au-task-1' };
    expect((await submitAutomationAction(req)).status).toBe('executed');
    expect((await submitAutomationAction(req)).duplicate).toBe(true);
    expect((await admin.from('tasks').select('id').eq('transaction_id', d1.transactionId).eq('name', 'Chase the title company')).data).toHaveLength(1);
  });

  it('a restricted action is refused and logged as refused', async () => {
    const out = await submitAutomationAction({ ownerUserId: tc.id, transactionId: d1.transactionId, kind: 'record_payment', inputs: {}, idempotencyKey: 'au-restricted-1' });
    expect(out.status).toBe('refused');
    expect((await admin.from('automation_actions').select('refusal_reason').eq('id', out.actionId).single()).data?.refusal_reason).toContain('restricted_action');
  });
});
