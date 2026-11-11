import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createTemplate } from '@/app/api/automation/templates/route';
import { POST as applyInstances } from '@/app/api/automation/instances/route';
import { POST as sendStepEmail } from '@/app/api/transactions/[id]/send-step-email/route';
import { PATCH as toggleTask } from '@/app/api/tasks/route';
import { submitAutomationAction } from '@/lib/automation/actions';
import { runInstances } from '@/lib/automation/instances';
import { admin, call, cleanup, createActor, seedDeal, type Actor, type Deal } from './helpers';

// Phase 1 + 2 of the automation redesign on the real relay-test database:
//   - the step Email button, templates and automation share one history, and an automatic email never repeats a manual one;
//   - completing a step creates the next one with a business-day due date, and a closed deal stops its reminders.
// Needs add-deal-email-log.sql and add-task-automation.sql to have been run on relay-test.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const agentEmail = (d: Deal) => `${d.marker.toLowerCase()}@example.test`;
const setMode = async (who: Actor, d: Deal, mode: string) => {
  await admin.from('automation_settings').delete().eq('transaction_id', d.transactionId);
  const { error } = await admin.from('automation_settings').insert({ owner_user_id: who.id, transaction_id: d.transactionId, mode, quiet_start_hour: 0, quiet_end_hour: 0 });
  if (error) throw new Error(error.message);
};
const logRows = async (d: Deal) => (await admin.from('deal_email_log').select('source, to_emails, task_id').eq('transaction_id', d.transactionId)).data ?? [];
const outbox = async (who: Actor, source: string) => (await admin.from('email_outbox').select('to_emails').eq('owner_user_id', who.id).eq('source', source)).data ?? [];

let tc: Actor, other: Actor;
const withFlags = process.env.RELAY_FEATURES;

beforeAll(async () => {
  tc = await createActor('ae-tc', { plan: 'pro' });
  other = await createActor('ae-other', { plan: 'pro' });
}, 90_000);
afterAll(async () => {
  process.env.RELAY_FEATURES = withFlags;
  await cleanup();
});

describe('one email history, no duplicates', () => {
  it('a step email sent with the Email button is recorded, and an automatic email for the same step is skipped', async () => {
    const d = await seedDeal(tc, 'AE1');
    await setMode(tc, d, 'auto');
    const sent = await call(h(sendStepEmail), tc, { method: 'POST', path: `/api/transactions/x/send-step-email`, params: { id: d.transactionId }, body: { to: [agentEmail(d)], subject: 'Please schedule the inspection', body: 'Hello', taskId: d.taskId } });
    expect(sent.status).toBe(200);
    expect(await logRows(d)).toEqual([expect.objectContaining({ source: 'step_button', task_id: d.taskId })]);
    expect((await outbox(tc, 'template')).length).toBeGreaterThan(0); // outbox on a dev machine, same sender as templates

    const out = await submitAutomationAction({ ownerUserId: tc.id, transactionId: d.transactionId, kind: 'send_step_email', fromApprovedTemplate: true, inputs: { taskId: d.taskId, to: [agentEmail(d)], subject: 'Following up: inspection', message: 'Any update?' }, idempotencyKey: 'ae-dup-1' });
    expect(out.status).toBe('executed');
    const row = (await admin.from('automation_actions').select('result').eq('idempotency_key', 'ae-dup-1').single()).data;
    expect((row?.result as { skipped?: string }).skipped).toBe('duplicate');
    expect(await outbox(tc, 'automation')).toHaveLength(0); // nothing went out
    expect(await logRows(d)).toHaveLength(1);
  });

  it('a different person, or a different step, is not blocked, and the automatic send is recorded too', async () => {
    const d = await seedDeal(tc, 'AE2');
    await setMode(tc, d, 'auto');
    const other = await admin.from('tasks').insert({ transaction_id: d.transactionId, name: 'Other step' }).select('id').single();
    await call(h(sendStepEmail), tc, { method: 'POST', path: `/api/transactions/x/send-step-email`, params: { id: d.transactionId }, body: { to: [agentEmail(d)], subject: 'About step one', body: 'Hello', taskId: d.taskId } });
    const out = await submitAutomationAction({ ownerUserId: tc.id, transactionId: d.transactionId, kind: 'send_step_email', fromApprovedTemplate: true, inputs: { taskId: other.data!.id, to: [agentEmail(d)], subject: 'About step two', message: 'Hi' }, idempotencyKey: 'ae-dup-2' });
    expect(out.status).toBe('executed');
    expect((await admin.from('automation_actions').select('result').eq('idempotency_key', 'ae-dup-2').single()).data?.result).toEqual(expect.objectContaining({ mode: 'outbox' }));
    expect((await logRows(d)).map((r) => r.source).sort()).toEqual(['automation', 'step_button']);
  });

  it("another account cannot send from, or see the history of, someone else's deal", async () => {
    const d = await seedDeal(tc, 'AE3');
    const res = await call(h(sendStepEmail), other, { method: 'POST', path: `/api/transactions/x/send-step-email`, params: { id: d.transactionId }, body: { to: [agentEmail(d)], subject: 'x', body: 'y' } });
    expect(res.status).toBe(403);
    expect(await logRows(d)).toHaveLength(0);
  });
});

describe('task-driven automation', () => {
  it('completing the watched step creates the next step with a business-day due date; completing it again does not repeat when nothing new happened', async () => {
    const d = await seedDeal(tc, 'AE4');
    await admin.from('tasks').update({ name: 'Inspection scheduling' }).eq('id', d.taskId);
    await admin.from('tasks').insert({ transaction_id: d.transactionId, name: 'Closing' }); // ticking the only step would close the deal, which (correctly) stops reminders
    const tpl = await call(h(createTemplate), tc, {
      method: 'POST',
      path: '/api/automation/templates',
      body: { name: 'Inspection chain', description: '', category: 'transaction', triggerType: 'task_completed', triggerTask: 'inspection scheduling', steps: [{ id: 's1', type: 'create_task', name: 'Collect inspection report', dueInDays: 3, dueFrom: 'trigger', businessDays: true, when: { days: 0, direction: 'after' } }] },
    });
    expect(tpl.status).toBe(201);
    const templateId = (tpl.json as { template: { id: string } }).template.id;
    expect((await call(h(applyInstances), tc, { method: 'POST', path: '/api/automation/instances', body: { transactionId: d.transactionId, templateIds: [templateId] } })).status).toBe(200);
    await setMode(tc, d, 'auto');

    expect((await call(h(toggleTask), tc, { method: 'PATCH', path: '/api/tasks', body: { taskId: d.taskId } })).status).toBe(200);
    await runInstances(new Date(), () => false, 50, { transactionId: d.transactionId });
    const created = (await admin.from('tasks').select('name, due_date').eq('transaction_id', d.transactionId).eq('name', 'Collect inspection report')).data ?? [];
    expect(created).toHaveLength(1);
    expect(created[0].due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([0, 6]).not.toContain(new Date(`${created[0].due_date}T00:00:00Z`).getUTCDay()); // never a weekend

    await runInstances(new Date(), () => false, 50, { transactionId: d.transactionId }); // a retry changes nothing
    expect(((await admin.from('tasks').select('id').eq('transaction_id', d.transactionId).eq('name', 'Collect inspection report')).data ?? [])).toHaveLength(1);
  });

  it('a closed deal stops its reminders', async () => {
    const d = await seedDeal(tc, 'AE5');
    const tpl = await call(h(createTemplate), tc, { method: 'POST', path: '/api/automation/templates', body: { name: 'Reminder', description: '', category: 'transaction', triggerType: 'transaction_created', steps: [{ id: 's1', type: 'create_task', name: 'Should not appear', when: { days: 0, direction: 'after' } }] } });
    const templateId = (tpl.json as { template: { id: string } }).template.id;
    await admin.from('transactions').update({ status: 'Closed' }).eq('id', d.transactionId); // closed before it is applied: applying also runs it at once
    await call(h(applyInstances), tc, { method: 'POST', path: '/api/automation/instances', body: { transactionId: d.transactionId, templateIds: [templateId] } });
    await setMode(tc, d, 'auto');
    await runInstances(new Date(), () => false, 50, { transactionId: d.transactionId });
    expect(((await admin.from('tasks').select('id').eq('transaction_id', d.transactionId).eq('name', 'Should not appear')).data ?? [])).toHaveLength(0);
  });
});

describe('documents and the checklist', () => {
  // Needs add-task-documents.sql on relay-test.
  const upload = async (d: Deal, name: string, type: string, extra: Record<string, string> = {}) => {
    const { NextRequest } = await import('next/server');
    const { POST: uploadDocument } = await import('@/app/api/documents/route');
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4 ' + name], name, { type: 'application/pdf' }));
    form.set('transactionId', d.transactionId);
    form.set('category', 'title_escrow');
    form.set('documentType', type);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return uploadDocument(new NextRequest('http://localhost/api/documents', { method: 'POST', headers: { authorization: `Bearer ${tc.token}` }, body: form }));
  };
  const task = async (id: string) => (await admin.from('tasks').select('completed, waiting_on, needs_review, received_document_id').eq('id', id).single()).data!;

  it('a title commitment arriving for a step we are waiting on marks it received, not complete, and stops the chasing', async () => {
    const d = await seedDeal(tc, 'AE6');
    await admin.from('tasks').update({ name: 'Request title commitment', waiting_on: 'Title company', waiting_on_since: '2026-11-01' }).eq('id', d.taskId);
    await admin.from('tasks').insert({ transaction_id: d.transactionId, name: 'Closing' });
    expect((await upload(d, 'commitment.pdf', 'Title Commitment')).status).toBe(201);
    const t = await task(d.taskId);
    expect(t).toEqual(expect.objectContaining({ completed: false, waiting_on: null, needs_review: true }));
    expect(t.received_document_id).toBeTruthy();
    expect((await admin.from('transaction_events').select('type').eq('transaction_id', d.transactionId).eq('type', 'task_received')).data).toHaveLength(1);
    expect((await admin.from('notifications').select('title').eq('transaction_id', d.transactionId).eq('event_type', 'assistant')).data?.map((n) => n.title)).toContain('Document received: review it');
  });

  it('an unclear match changes nothing and asks; a scheduling step is never matched', async () => {
    const d = await seedDeal(tc, 'AE7');
    await admin.from('tasks').update({ name: 'Schedule inspection' }).eq('id', d.taskId);
    await upload(d, 'report.pdf', 'Inspection Report');
    expect(await task(d.taskId)).toEqual(expect.objectContaining({ needs_review: false, completed: false }));
  });

  it('the same file uploaded twice raises a duplicate notice', async () => {
    const d = await seedDeal(tc, 'AE8');
    await upload(d, 'same.pdf', 'Survey');
    await upload(d, 'same.pdf', 'Survey');
    expect((await admin.from('notifications').select('title').eq('transaction_id', d.transactionId).eq('event_type', 'assistant')).data?.map((n) => n.title)).toContain('Possible duplicate document');
  });

  it('a Starter account gets no automatic matching', async () => {
    const starter = await createActor('ae-starter', { plan: 'starter' });
    const d = await seedDeal(starter, 'AE9');
    await admin.from('tasks').update({ name: 'Request title commitment', waiting_on: 'Title company' }).eq('id', d.taskId);
    const { NextRequest } = await import('next/server');
    const { POST: uploadDocument } = await import('@/app/api/documents/route');
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4 x'], 'c.pdf', { type: 'application/pdf' }));
    form.set('transactionId', d.transactionId);
    form.set('category', 'title_escrow');
    form.set('documentType', 'Title Commitment');
    await uploadDocument(new NextRequest('http://localhost/api/documents', { method: 'POST', headers: { authorization: `Bearer ${starter.token}` }, body: form }));
    expect(await task(d.taskId)).toEqual(expect.objectContaining({ needs_review: false, waiting_on: 'Title company' }));
  });
});
