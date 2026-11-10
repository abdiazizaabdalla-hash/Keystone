import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/automation/templates/route';
import { PUT as editTemplate, PATCH as switchTemplate, DELETE as deleteTemplate } from '@/app/api/automation/templates/[id]/route';
import { POST as duplicateTemplate } from '@/app/api/automation/templates/[id]/duplicate/route';
import { POST as updateCopies } from '@/app/api/automation/templates/[id]/update-copies/route';
import { GET as listInstances, POST as applyInstances } from '@/app/api/automation/instances/route';
import { DELETE as removeInstance } from '@/app/api/automation/instances/[id]/route';
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
});
