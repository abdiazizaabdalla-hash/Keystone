import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/automation/templates/route';
import { PUT as editTemplate, PATCH as switchTemplate, DELETE as deleteTemplate } from '@/app/api/automation/templates/[id]/route';
import { POST as duplicateTemplate } from '@/app/api/automation/templates/[id]/duplicate/route';
import { POST as updateCopies } from '@/app/api/automation/templates/[id]/update-copies/route';
import { GET as listInstances, POST as applyInstances } from '@/app/api/automation/instances/route';
import { DELETE as removeInstance, PATCH as patchInstance } from '@/app/api/automation/instances/[id]/route';
import { POST as runStep } from '@/app/api/automation/instances/[id]/run/route';
import { GET as getProgress } from '@/app/api/automation/progress/route';
import { GET as getAlerts, POST as ackAlerts } from '@/app/api/automation/alerts/route';
import { GET as listApprovals } from '@/app/api/automation/approvals/route';
import { POST as decideAction } from '@/app/api/automation/actions/[id]/decide/route';
import { localHour } from '@/lib/automation/guard';
import { GET as listTransactions } from '@/app/api/transactions/route';
import { GET as getListing } from '@/app/api/listings/[id]/route';
import { GET as getHistory } from '@/app/api/automation/history/route';
import { runInstances } from '@/lib/automation/instances';
import { admin, call, cleanup, createActor, createCollaborator, seedDeal, type Actor, type Deal } from './helpers';

// The Automation Library on the real relay-test database: save, edit, apply as independent copies, fire real steps once,
// stop what is queued when a copy is removed or the template is switched off, and keep other accounts out.
// Needs add-automation-library.sql to have been run on relay-test.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;
const notify = (title: string) => ({ id: 's1', type: 'notify_me', when: { days: 0, direction: 'after' }, title });
const def = (over: Record<string, unknown> = {}) => ({ name: 'Onboarding', description: 'd', category: 'transaction', triggerType: 'transaction_created', steps: [notify('Welcome')], ...over });
const post = (who: Actor, path: string, body: unknown, handler: unknown, params?: Record<string, string>) => call(h(handler), who, { method: 'POST', path, body, params });
const create = async (who: Actor, over?: Record<string, unknown>) => ((await post(who, '/api/automation/templates', def(over), createTemplate)).json as { template: { id: string } }).template.id;
const apply = (who: Actor, d: Deal, templateIds: string[]) => post(who, '/api/automation/instances', { transactionId: d.transactionId, templateIds }, applyInstances);
const copies = async (who: Actor, d: Deal) => ((await call(h(listInstances), who, { method: 'GET', path: `/api/automation/instances?transactionId=${d.transactionId}` })).json as { instances: { id: string; name: string; missingRoles: string[]; template_version: number; status: string; steps: { title?: string }[] }[] }).instances;
const actions = async (instanceId: string) => (await admin.from('automation_actions').select('status, kind, refusal_reason, instance_id, step_id').eq('instance_id', instanceId)).data ?? [];

const noQuietHours = (listingId: string) => admin.from('automation_settings').update({ quiet_start_hour: 0, quiet_end_hour: 0 }).eq('listing_id', listingId); // tests must not depend on the time of day

let tc: Actor, other: Actor, collab: Actor;
let d1: Deal, d2: Deal, dOther: Deal;
beforeAll(async () => {
  tc = await createActor('lib-tc');
  other = await createActor('lib-other');
  collab = await createCollaborator('lib-collab');
  [d1, d2, dOther] = [await seedDeal(tc, 'LIB1'), await seedDeal(tc, 'LIB2'), await seedDeal(other, 'LIBO')];
}, 90_000);
afterAll(cleanup);

describe('saving automations', () => {
  it('saves, lists with counts, refuses bad input in words, and duplicates', async () => {
    const id = await create(tc);
    const list = (await call(h(listTemplates), tc, { method: 'GET', path: '/api/automation/templates' })).json as { templates: { id: string; dealCount: number }[] };
    expect(list.templates.find((t) => t.id === id)?.dealCount).toBe(0);
    const bad = await post(tc, '/api/automation/templates', def({ steps: [] }), createTemplate);
    expect(bad.status).toBe(400);
    expect((bad.json as { error: string }).error).toMatch(/at least one step/);
    expect((await post(tc, '/api/automation/templates', def({ steps: [{ ...notify('x'), type: 'delete_deal' }] }), createTemplate)).status).toBe(400);
    const dup = await post(tc, `/api/automation/templates/${id}/duplicate`, {}, duplicateTemplate, { id });
    expect(dup.status).toBe(201);
    expect(((dup.json as { template: { name: string } }).template.name)).toBe('Onboarding (copy)');
  });

  it("other accounts cannot see, edit, apply, switch or delete someone else's automation; collaborators are refused", async () => {
    const id = await create(tc);
    const edit = (who: Actor) => call(h(editTemplate), who, { method: 'PUT', path: `/api/automation/templates/${id}`, body: def(), params: { id } });
    expect([404]).toContain((await edit(other)).status);
    expect((await call(h(switchTemplate), other, { method: 'PATCH', path: `/api/automation/templates/${id}`, body: { active: false }, params: { id } })).status).toBe(404);
    expect((await call(h(deleteTemplate), other, { method: 'DELETE', path: `/api/automation/templates/${id}`, params: { id } })).status).toBe(404);
    const stolen = await apply(other, dOther, [id]);
    expect((stolen.json as { applied: string[] }).applied).toEqual([]);
    expect((await apply(other, d1, [id])).status).toBe(404); // not their deal
    expect((await post(collab, '/api/automation/templates', def(), createTemplate)).status).toBe(403);
  });
});

describe('applying and running', () => {
  it('each deal gets its own copy; editing the template changes nothing until the copies are updated on purpose', async () => {
    const id = await create(tc, { name: 'Independent' });
    expect((await apply(tc, d1, [id])).status).toBe(200);
    expect((await apply(tc, d2, [id])).status).toBe(200);
    const again = (await apply(tc, d1, [id])).json as { applied: string[]; skipped: { reason: string }[] };
    expect(again.applied).toEqual([]);
    expect(again.skipped[0].reason).toMatch(/Already applied/);

    await call(h(editTemplate), tc, { method: 'PUT', path: `/api/automation/templates/${id}`, body: def({ name: 'Independent', steps: [notify('Changed')] }), params: { id } });
    expect((await copies(tc, d1))[0].steps[0].title).toBe('Welcome');
    const upd = (await post(tc, `/api/automation/templates/${id}/update-copies`, {}, updateCopies, { id })).json as { updated: number };
    expect(upd.updated).toBe(2);
    expect((await copies(tc, d1))[0].steps[0].title).toBe('Changed');
    expect((await copies(tc, d2))[0].template_version).toBe(2);
    // applying turned the assistant on for the deal (Draft) so the copy can run at all
    expect((await admin.from('automation_settings').select('mode').eq('transaction_id', d1.transactionId).single()).data?.mode).toBe('draft');
  });

  it('a real step fires once, is logged against its copy, and a second run does nothing new', async () => {
    const id = await create(tc, { name: 'Fires once' });
    await apply(tc, d1, [id]);
    const inst = (await copies(tc, d1)).find((c) => c.name === 'Fires once')!;
    const a = await runInstances(new Date(), () => false);
    expect(a.errors).toEqual([]);
    const rows = await actions(inst.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'notify_user', status: 'executed', step_id: 's1' });
    await runInstances(new Date(), () => false);
    expect(await actions(inst.id)).toHaveLength(1);
    const hist = (await call(h(getHistory), tc, { method: 'GET', path: `/api/automation/history?templateId=${id}` })).json as { runs: { status: string }[] };
    expect(hist.runs.map((r) => r.status)).toEqual(['executed']);
  });

  it('an email to someone not on the deal is refused and says why; an email to the agent waits for approval, and removing the copy cancels it', async () => {
    const nobody = await create(tc, { name: 'Lender email', steps: [{ id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['lender'], subject: 'Hi', message: 'Hi {{address}}' }] });
    const agent = await create(tc, { name: 'Agent email', steps: [{ id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['agent'], subject: 'Hi', message: 'Hello' }] });
    await apply(tc, d2, [nobody, agent]);
    await admin.from('automation_settings').update({ quiet_start_hour: 0, quiet_end_hour: 0 }).eq('transaction_id', d2.transactionId); // not time-of-day dependent
    await runInstances(new Date(), () => false);
    const cs = await copies(tc, d2);
    const lender = cs.find((c) => c.name === 'Lender email')!;
    const toAgent = cs.find((c) => c.name === 'Agent email')!;
    // the deal tab warns up front: nobody on this deal is a Lender, but the agent exists
    expect(lender.missingRoles).toEqual(['Lender']);
    expect(toAgent.missingRoles).toEqual([]);
    expect((await actions(lender.id))[0]).toMatchObject({ status: 'refused', refusal_reason: 'no_recipients' });
    expect((await actions(toAgent.id))[0].status).toBe('awaiting_approval');

    expect((await call(h(removeInstance), tc, { method: 'DELETE', path: `/api/automation/instances/${toAgent.id}`, params: { id: toAgent.id } })).status).toBe(200);
    expect((await actions(toAgent.id))[0]).toMatchObject({ status: 'cancelled', refusal_reason: 'automation_removed' });
    expect((await copies(tc, d2)).some((c) => c.id === toAgent.id)).toBe(false);
    expect((await call(h(removeInstance), other, { method: 'DELETE', path: `/api/automation/instances/${lender.id}`, params: { id: lender.id } })).status).toBe(404);
  });

  it('switching a template off pauses its copies and stops them firing; deleting it removes the copies', async () => {
    const id = await create(tc, { name: 'Off switch', triggerType: 'closing_date', steps: [{ ...notify('Soon'), when: { days: 0, direction: 'before' } }] });
    await apply(tc, d1, [id]);
    await call(h(switchTemplate), tc, { method: 'PATCH', path: `/api/automation/templates/${id}`, body: { active: false }, params: { id } });
    const paused = (await admin.from('automation_instances').select('status').eq('template_id', id)).data ?? [];
    expect(paused.map((p) => p.status)).toEqual(['paused']);
    // an inactive automation cannot be applied to another deal
    expect(((await apply(tc, d2, [id])).json as { skipped: { reason: string }[] }).skipped[0].reason).toMatch(/switched off/);
    const del = await call(h(deleteTemplate), tc, { method: 'DELETE', path: `/api/automation/templates/${id}`, params: { id } });
    expect((del.json as { stoppedCopies: number }).stoppedCopies).toBe(1);
    expect((await copies(tc, d1)).some((c) => c.name === 'Off switch')).toBe(false);
  });

  it('an "only if" condition holds a step back while false and lets it through once true', async () => {
    const id = await create(tc, { name: 'Conditional', steps: [{ ...notify('Appraisal?'), condition: { type: 'key_date_open', kind: 'appraisal' } }] });
    await admin.from('transaction_key_dates').delete().eq('transaction_id', d1.transactionId);
    const { data: kd } = await admin.from('transaction_key_dates').insert({ transaction_id: d1.transactionId, kind: 'appraisal', label: 'Appraisal', due_date: '2027-03-01', completed: true }).select('id').single();
    await apply(tc, d1, [id]);
    const inst = (await copies(tc, d1)).find((c) => c.name === 'Conditional')!;
    await runInstances(new Date(), () => false);
    expect(await actions(inst.id)).toHaveLength(0); // the appraisal is marked done, so nothing is sent
    await admin.from('transaction_key_dates').update({ completed: false }).eq('id', kd!.id);
    await runInstances(new Date(), () => false);
    expect(await actions(inst.id)).toHaveLength(1);
  });

  it('a listing automation applies to a listing and a listing cannot take a transaction automation', async () => {
    const { data: listing } = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '1 Lib St', status: 'preparing' }).select('id').single();
    const li = await create(tc, { name: 'Listing hello', category: 'listing', triggerType: 'listing_created', steps: [notify('New listing')] });
    const tx = await create(tc, { name: 'Tx only' });
    const res = (await post(tc, '/api/automation/instances', { listingId: listing!.id, templateIds: [li, tx] }, applyInstances)).json as { applied: string[]; skipped: { reason: string }[] };
    expect(res.applied).toEqual([li]);
    expect(res.skipped[0].reason).toMatch(/transaction automation/);
    await runInstances(new Date(), () => false);
    const inst = (await admin.from('automation_instances').select('id').eq('listing_id', listing!.id)).data![0];
    expect((await actions(inst.id as string))[0]).toMatchObject({ kind: 'notify_user', status: 'executed' });
    await admin.from('automation_actions').delete().eq('listing_id', listing!.id);
    await admin.from('automation_instances').delete().eq('listing_id', listing!.id);
    await admin.from('automation_settings').delete().eq('listing_id', listing!.id);
    await admin.from('listings').delete().eq('id', listing!.id);
  });
  it('a listing gets emails and checklist steps when an offer arrives; only its own contacts can be emailed', async () => {
    const { data: listing } = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '2 Offer St', status: 'active', seller_name: 'Sam Seller' }).select('id').single();
    const lid = listing!.id as string;
    await admin.from('listing_contacts').insert([{ listing_id: lid, role: 'Seller', name: 'Sam Seller', email: 'sam.seller@example.com', position: 0 }]);
    const steps = [
      { id: 's1', type: 'create_task', when: { days: 0, direction: 'after' }, name: 'Review the offer', dueInDays: 1 },
      { id: 's2', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['seller'], subject: 'New offer on {{address}}', message: 'Hello {{client_name}}' },
      { id: 's3', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['lender'], subject: 'x', message: 'y' },
    ];
    const t = await create(tc, { name: 'Offer in', category: 'listing', triggerType: 'offer_received', steps });
    await post(tc, '/api/automation/instances', { listingId: lid, templateIds: [t] }, applyInstances);
    await noQuietHours(lid);
    const inst = (await admin.from('automation_instances').select('id').eq('listing_id', lid)).data![0].id as string;

    await runInstances(new Date(), () => false);
    expect(await actions(inst)).toEqual([]); // no offer yet: nothing happens

    const listed = (await call(h(listInstances), tc, { method: 'GET', path: `/api/automation/instances?listingId=${lid}` })).json as { instances: { missingRoles: string[] }[] };
    expect(listed.instances[0].missingRoles).toEqual(['Lender']); // the warning works for listings too

    const offerIns = await admin.from('listing_offers').insert({ listing_id: lid, buyer_name: 'Bea Buyer', offer_price: 400000, status: 'received' });
    expect(offerIns.error).toBeNull();
    await runInstances(new Date(Date.now() + 5000), () => false); // a few seconds on, so database/test-machine clock skew can't matter
    const acts = await actions(inst);
    expect(acts.find((a) => a.step_id === 's1')).toMatchObject({ kind: 'create_task', status: 'executed' });
    expect((await admin.from('listing_tasks').select('name').eq('listing_id', lid)).data?.map((r) => r.name)).toEqual(['Review the offer']);
    expect(acts.find((a) => a.step_id === 's2')).toMatchObject({ kind: 'send_deal_email', status: 'awaiting_approval' }); // Draft mode waits
    expect(acts.find((a) => a.step_id === 's3')).toMatchObject({ status: 'refused' }); // nobody with that role: refused, never sent

    const before = acts.length;
    await runInstances(new Date(Date.now() + 5000), () => false); // a few seconds on, so database/test-machine clock skew can't matter
    expect((await actions(inst)).length).toBe(before); // one offer, one set of actions

    await admin.from('automation_actions').delete().eq('listing_id', lid);
    await admin.from('automation_instances').delete().eq('listing_id', lid);
    await admin.from('automation_settings').delete().eq('listing_id', lid);
    await admin.from('listing_offers').delete().eq('listing_id', lid);
    await admin.from('listing_tasks').delete().eq('listing_id', lid);
    await admin.from('listing_contacts').delete().eq('listing_id', lid);
    await admin.from('listings').delete().eq('id', lid);
  });
  it('the tracker shows each step, runs one on demand once, pauses and resumes, and is closed to other accounts', async () => {
    const planned = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const { data: listing } = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '3 Tracker St', status: 'preparing', planned_list_date: planned }).select('id').single();
    const lid = listing!.id as string;
    const steps = [
      { id: 's1', type: 'notify_me', when: { days: 5, direction: 'before' }, title: 'Almost live: {{address}}' },
      { id: 's2', type: 'add_note', when: { days: 0, direction: 'after' }, text: 'Went live' },
    ];
    const t = await create(tc, { name: 'Tracked', category: 'listing', triggerType: 'listing_planned_list_date', steps });
    await post(tc, '/api/automation/instances', { listingId: lid, templateIds: [t] }, applyInstances);
    const inst = (await admin.from('automation_instances').select('id').eq('listing_id', lid)).data![0].id as string;
    const progress = async (who: Actor = tc) => call(h(getProgress), who, { method: 'GET', path: `/api/automation/progress?listingId=${lid}` });
    type P = { automations: { id: string; status: string; done: number; total: number; steps: { id: string; state: string; due: string | null; manual: boolean }[] }[]; mode: string };

    const first = (await progress()).json as P;
    expect(first.mode).toBe('draft');
    expect(first.automations[0].steps.map((x) => x.state)).toEqual(['scheduled', 'scheduled']);
    expect(first.automations[0].steps[0].due).toBe(new Date(Date.parse(`${planned}T00:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10));
    expect(first.automations[0]).toMatchObject({ done: 0, total: 2 });

    const run1 = await post(tc, `/api/automation/instances/${inst}/run`, { stepId: 's1' }, runStep, { id: inst });
    expect((run1.json as { results: { status: string }[] }).results[0].status).toBe('executed');
    const again = await post(tc, `/api/automation/instances/${inst}/run`, { stepId: 's1' }, runStep, { id: inst });
    expect((again.json as { results: { status: string }[] }).results[0].status).toBe('already_running'); // a double click sends nothing twice
    const mid = (await progress()).json as P;
    expect(mid.automations[0].steps[0]).toMatchObject({ state: 'done', manual: true });
    expect(mid.automations[0]).toMatchObject({ done: 1, total: 2 });

    expect((await post(tc, `/api/automation/instances/${inst}/run`, { stepId: 'nope' }, runStep, { id: inst })).status).toBe(400);
    expect((await call(h(patchInstance), tc, { method: 'PATCH', path: `/api/automation/instances/${inst}`, body: { status: 'paused' }, params: { id: inst } })).status).toBe(200);
    expect((await post(tc, `/api/automation/instances/${inst}/run`, {}, runStep, { id: inst })).status).toBe(409); // paused: nothing runs
    expect(((await progress()).json as P).automations[0].status).toBe('paused');
    await call(h(patchInstance), tc, { method: 'PATCH', path: `/api/automation/instances/${inst}`, body: { status: 'active' }, params: { id: inst } });

    const rest = (await post(tc, `/api/automation/instances/${inst}/run`, {}, runStep, { id: inst })).json as { results: { stepId: string; status: string }[] };
    expect(rest.results.map((r) => r.stepId)).toEqual(['s2']); // "run what is left" skips what is already done
    expect(((await progress()).json as P).automations[0]).toMatchObject({ done: 2, total: 2 });

    // Other accounts cannot see or run anything here.
    expect((await progress(other)).status).toBe(404);
    expect((await call(h(runStep), other, { method: 'POST', path: `/api/automation/instances/${inst}/run`, body: {}, params: { id: inst } })).status).toBe(404);
    expect((await call(h(patchInstance), other, { method: 'PATCH', path: `/api/automation/instances/${inst}`, body: { status: 'paused' }, params: { id: inst } })).status).toBe(404);

    await admin.from('automation_actions').delete().eq('listing_id', lid);
    await admin.from('automation_instances').delete().eq('listing_id', lid);
    await admin.from('automation_settings').delete().eq('listing_id', lid);
    await admin.from('listings').delete().eq('id', lid);
  });
  it('banners: a draft email and reminders appear, reminders go away when acknowledged, drafts when decided', async () => {
    const { data: listing } = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '4 Banner St', status: 'preparing' }).select('id').single();
    const lid = listing!.id as string;
    await admin.from('listing_contacts').insert([{ listing_id: lid, role: 'Seller', name: 'Sam', email: 'sam.banner@example.com', position: 0 }]);
    const steps = [
      { id: 's1', type: 'notify_me', when: { days: 0, direction: 'after' }, title: 'Reminder one' },
      { id: 's2', type: 'notify_me', when: { days: 0, direction: 'after' }, title: 'Reminder two' },
      { id: 's3', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['seller'], subject: 'Hello {{address}}', message: 'Hi' },
      { id: 's4', type: 'create_task', when: { days: 0, direction: 'after' }, name: 'A quiet task' },
    ];
    const t = await create(tc, { name: 'Banners', category: 'listing', triggerType: 'listing_created', steps });
    await post(tc, '/api/automation/instances', { listingId: lid, templateIds: [t] }, applyInstances);
    await noQuietHours(lid);
    await runInstances(new Date(Date.now() + 5000), () => false);
    type A = { alerts: { id: string; kind: string; title: string }[]; count: number };
    const get = async (who: Actor = tc) => call(h(getAlerts), who, { method: 'GET', path: `/api/automation/alerts?listingId=${lid}` });
    const first = (await get()).json as A;
    expect(first.alerts.map((a) => a.kind)).toEqual(['approval', 'reminder', 'reminder']); // the task made no banner; the approval comes first
    expect(first.count).toBe(3);

    const reminder = first.alerts.find((a) => a.kind === 'reminder')!;
    expect((await post(tc, '/api/automation/alerts', { actionId: reminder.id }, ackAlerts)).status).toBe(200);
    expect(((await get()).json as A).count).toBe(2);
    expect((await post(other, '/api/automation/alerts', { actionId: reminder.id }, ackAlerts)).status).toBe(404); // not theirs
    expect((await get(other)).status).toBe(404);

    const draft = first.alerts.find((a) => a.kind === 'approval')!;
    expect((await post(tc, '/api/automation/alerts', { actionId: draft.id }, ackAlerts)).status).toBe(404); // a draft is decided, not dismissed
    expect(((await get()).json as A).alerts.some((a) => a.kind === 'approval')).toBe(true);

    expect(((await post(tc, '/api/automation/alerts', { listingId: lid, all: true }, ackAlerts)).json as { acknowledged: number }).acknowledged).toBe(1);
    const left = (await get()).json as A;
    expect(left.alerts.map((a) => a.kind)).toEqual(['approval']);

    const inst = (await admin.from('automation_instances').select('id').eq('listing_id', lid)).data![0].id as string;
    await call(h(removeInstance), tc, { method: 'DELETE', path: `/api/automation/instances/${inst}`, params: { id: inst } });
    expect(((await get()).json as A).count).toBe(0); // removing the automation takes its banners with it

    await admin.from('automation_actions').delete().eq('listing_id', lid);
    await admin.from('automation_instances').delete().eq('listing_id', lid);
    await admin.from('automation_settings').delete().eq('listing_id', lid);
    await admin.from('listing_tasks').delete().eq('listing_id', lid);
    await admin.from('listing_contacts').delete().eq('listing_id', lid);
    await admin.from('listings').delete().eq('id', lid);
  });
  it('quick create and edit on one file: file-only automations, locked trigger, removed steps lose their queue, owner-only', async () => {
    const { data: listing } = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '5 Quick St', status: 'preparing' }).select('id').single();
    const lid = listing!.id as string;
    await admin.from('listing_contacts').insert([{ listing_id: lid, role: 'Seller', name: 'Sam', email: 'sam.quick@example.com', position: 0 }]);

    // Only the owner is told they can automate.
    const own = (await call(h(getListing), tc, { method: 'GET', path: `/api/listings/${lid}`, params: { id: lid } })).json as { canAutomate?: boolean };
    expect(own.canAutomate).toBe(true);
    const txs = (await call(h(listTransactions), tc, { method: 'GET', path: '/api/transactions' })).json as { id: string; canAutomate?: boolean }[];
    expect(txs.find((t) => t.id === d1.transactionId)?.canAutomate).toBe(true);

    const def = {
      name: 'Just here', description: '', category: 'listing', triggerType: 'listing_created',
      steps: [
        { id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['seller'], subject: 'Hello {{address}}', message: 'Hi' },
        { id: 's2', type: 'notify_me', when: { days: 30, direction: 'after' }, title: 'A month in' },
      ],
    };
    // A transaction automation cannot be put on a listing; a bad one is refused in words.
    expect((await post(tc, '/api/automation/instances', { listingId: lid, definition: { ...def, category: 'transaction', triggerType: 'transaction_created' } }, applyInstances)).status).toBe(400);
    expect((await post(tc, '/api/automation/instances', { listingId: lid, definition: { ...def, steps: [] } }, applyInstances)).status).toBe(400);
    expect((await post(other, '/api/automation/instances', { listingId: lid, definition: def }, applyInstances)).status).toBe(404);

    const made = await post(tc, '/api/automation/instances', { listingId: lid, definition: def }, applyInstances);
    expect(made.status).toBe(200);
    const inst = (await admin.from('automation_instances').select('id, template_id').eq('listing_id', lid)).data![0];
    expect(inst.template_id).toBeNull(); // lives on this file only
    await noQuietHours(lid);
    expect(await admin.from('automation_templates').select('id').eq('owner_user_id', tc.id).eq('name', 'Just here')).toMatchObject({ data: [] });

    await runInstances(new Date(Date.now() + 5000), () => false); // the email waits for approval (Draft)
    expect((await actions(inst.id as string)).find((a) => a.step_id === 's1')).toMatchObject({ status: 'awaiting_approval' });

    const edit = (who: Actor, body: unknown) => call(h(patchInstance), who, { method: 'PATCH', path: `/api/automation/instances/${inst.id}`, body, params: { id: inst.id as string } });
    expect((await edit(other, { definition: def })).status).toBe(404);
    expect((await edit(tc, { definition: { ...def, triggerType: 'listing_expiration' } })).status).toBe(400); // when it starts is fixed on a file
    expect((await edit(tc, { definition: { ...def, category: 'transaction' } })).status).toBe(400);

    // Drop the email (s1) and rename the notice: the waiting draft is cancelled, the rest is kept.
    const edited = { ...def, name: 'Just here, edited', steps: [{ id: 's2', type: 'notify_me', when: { days: 30, direction: 'after' }, title: 'A month in (edited)' }] };
    expect((await edit(tc, { definition: edited })).status).toBe(200);
    const row = (await admin.from('automation_instances').select('name, steps').eq('id', inst.id as string).single()).data!;
    expect(row.name).toBe('Just here, edited');
    expect((row.steps as { id: string }[]).map((x) => x.id)).toEqual(['s2']);
    expect((await actions(inst.id as string)).find((a) => a.step_id === 's1')).toMatchObject({ status: 'cancelled' });

    await admin.from('automation_actions').delete().eq('listing_id', lid);
    await admin.from('automation_instances').delete().eq('listing_id', lid);
    await admin.from('automation_settings').delete().eq('listing_id', lid);
    await admin.from('listing_contacts').delete().eq('listing_id', lid);
    await admin.from('listings').delete().eq('id', lid);
  });
  it('a draft email reaches you for approval the moment the automation is added, even in quiet hours, and approving sends it now', async () => {
    const { data: listing } = await admin.from('listings').insert({ tc_user_id: tc.id, property_address: '6 Popup St', status: 'preparing' }).select('id').single();
    const lid = listing!.id as string;
    await admin.from('listing_contacts').insert([{ listing_id: lid, role: 'Seller', name: 'Sam', email: 'sam.popup@example.com', position: 0 }]);
    const steps = [{ id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['seller'], subject: 'Welcome to {{address}}', message: 'Hello {{client_name}}' }];
    const t = await create(tc, { name: 'Popup', category: 'listing', triggerType: 'listing_created', steps });
    // Make "now" quiet hours for this listing: the old behaviour held the draft until morning.
    await admin.from('automation_settings').insert({ owner_user_id: tc.id, listing_id: lid, mode: 'draft', quiet_start_hour: localHour(new Date(), 'America/Chicago'), quiet_end_hour: (localHour(new Date(), 'America/Chicago') + 1) % 24, time_zone: 'America/Chicago' });

    await post(tc, '/api/automation/instances', { listingId: lid, templateIds: [t] }, applyInstances); // no runInstances call: applying runs it
    const inst = (await admin.from('automation_instances').select('id').eq('listing_id', lid)).data![0].id as string;
    const acts = await actions(inst);
    expect(acts).toHaveLength(1);
    expect(acts[0].status).toBe('awaiting_approval');

    const pending = (await call(h(listApprovals), tc, { method: 'GET', path: '/api/automation/approvals' })).json as { approvals: { actionId: string; listingId: string | null; deal: { address: string } | null; inputs: { to: string[]; subject: string } }[] };
    const mine = pending.approvals.find((a) => a.listingId === lid)!;
    expect(mine.deal?.address).toBe('6 Popup St');
    expect(mine.inputs).toMatchObject({ to: ['sam.popup@example.com'], subject: 'Welcome to 6 Popup St' });

    const before = (await admin.from('email_outbox').select('id').eq('owner_user_id', tc.id)).data?.length ?? 0;
    const ok = await post(tc, `/api/automation/actions/${mine.actionId}/decide`, { decision: 'approve' }, decideAction, { id: mine.actionId });
    expect(ok.status).toBe(200);
    expect((await actions(inst))[0].status).toBe('executed'); // went now, in quiet hours, because the owner approved it
    expect(((await admin.from('email_outbox').select('id').eq('owner_user_id', tc.id)).data?.length ?? 0)).toBe(before + 1);

    // The tracker says what happened to the email: here it was saved to the test outbox, and it can be read back.
    const prog = (await call(h(getProgress), tc, { method: 'GET', path: `/api/automation/progress?listingId=${lid}` })).json as { outboxOnly: boolean; automations: { steps: { state: string; sent: { to: string[]; subject: string; mode: string } | null }[] }[] };
    expect(prog.outboxOnly).toBe(true);
    expect(prog.automations[0].steps[0]).toMatchObject({ state: 'done', sent: { to: ['sam.popup@example.com'], subject: 'Welcome to 6 Popup St', mode: 'outbox' } });

    await admin.from('email_outbox').delete().eq('owner_user_id', tc.id).like('subject', 'Welcome to 6 Popup%');
    await admin.from('automation_actions').delete().eq('listing_id', lid);
    await admin.from('automation_instances').delete().eq('listing_id', lid);
    await admin.from('automation_settings').delete().eq('listing_id', lid);
    await admin.from('listing_contacts').delete().eq('listing_id', lid);
    await admin.from('listings').delete().eq('id', lid);
  });
});
