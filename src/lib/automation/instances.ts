import { supabaseServer } from '../supabase';
import { loadDealForTemplates, recipientsOf } from '../templateContext';
import { submitAutomationAction } from './actions';
import { KEY_DATE_KIND_OF, dueSteps, fillVars, localDayOf, resolveRecipients, triggerOf, validateDefinition, type Definition, type InstanceFacts, type Step } from './library';
import { DEFAULT_SETTINGS } from './server';

// Database side of the Automation Library: templates, the independent copies applied to deals and listings, and the engine
// step that fires a copy's due steps. Every query is scoped to the owner; callers prove ownership of a deal or listing first.

export interface TemplateRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  category: 'transaction' | 'listing';
  trigger_type: string;
  steps: Step[];
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface InstanceRow {
  id: string;
  template_id: string | null;
  owner_user_id: string;
  transaction_id: string | null;
  listing_id: string | null;
  name: string;
  category: 'transaction' | 'listing';
  trigger_type: string;
  steps: Step[];
  template_version: number;
  status: 'active' | 'paused' | 'removed';
  created_at: string;
}

const TEMPLATE_COLS = 'id, owner_user_id, name, description, category, trigger_type, steps, active, version, created_at, updated_at';
const INSTANCE_COLS = 'id, template_id, owner_user_id, transaction_id, listing_id, name, category, trigger_type, steps, template_version, status, created_at';
const PENDING = ['proposed', 'awaiting_approval', 'approved', 'deferred'];

export async function listTemplates(ownerId: string) {
  const [{ data: templates, error }, { data: instances }] = await Promise.all([
    supabaseServer.from('automation_templates').select(TEMPLATE_COLS).eq('owner_user_id', ownerId).order('created_at', { ascending: false }),
    supabaseServer.from('automation_instances').select('id, template_id, template_version, status').eq('owner_user_id', ownerId).neq('status', 'removed'),
  ]);
  if (error) throw error;
  const ids = (instances ?? []).map((i) => i.id as string);
  const { data: actions } = ids.length ? await supabaseServer.from('automation_actions').select('instance_id, status').in('instance_id', ids).limit(5000) : { data: [] };
  const byInstance = new Map<string, { ok: number; failed: number; pending: number }>();
  for (const a of actions ?? []) {
    const e = byInstance.get(a.instance_id as string) ?? { ok: 0, failed: 0, pending: 0 };
    if (a.status === 'executed') e.ok++;
    else if (a.status === 'failed' || a.status === 'refused') e.failed++;
    else if (PENDING.includes(a.status as string)) e.pending++;
    byInstance.set(a.instance_id as string, e);
  }
  return ((templates ?? []) as TemplateRow[]).map((t) => {
    const mine = (instances ?? []).filter((i) => i.template_id === t.id);
    const stats = mine.reduce((s, i) => {
      const e = byInstance.get(i.id as string);
      return e ? { ok: s.ok + e.ok, failed: s.failed + e.failed, pending: s.pending + e.pending } : s;
    }, { ok: 0, failed: 0, pending: 0 });
    return { ...t, dealCount: mine.length, outdatedCount: mine.filter((i) => (i.template_version as number) < t.version).length, stats };
  });
}

export async function getTemplate(ownerId: string, id: string): Promise<TemplateRow | null> {
  const { data } = await supabaseServer.from('automation_templates').select(TEMPLATE_COLS).eq('id', id).eq('owner_user_id', ownerId).maybeSingle();
  return (data as TemplateRow | null) ?? null;
}

export async function saveTemplate(ownerId: string, def: Definition, existingId?: string): Promise<TemplateRow> {
  const fields = { name: def.name, description: def.description, category: def.category, trigger_type: def.triggerType, steps: def.steps, updated_at: new Date().toISOString() };
  if (!existingId) {
    const { data, error } = await supabaseServer.from('automation_templates').insert({ ...fields, owner_user_id: ownerId }).select(TEMPLATE_COLS).single();
    if (error) throw error;
    return data as TemplateRow;
  }
  const current = await getTemplate(ownerId, existingId);
  if (!current) throw Object.assign(new Error('Not found'), { notFound: true });
  const { data, error } = await supabaseServer.from('automation_templates').update({ ...fields, version: current.version + 1 }).eq('id', existingId).eq('owner_user_id', ownerId).select(TEMPLATE_COLS).single();
  if (error) throw error;
  return data as TemplateRow;
}

/** Stops everything a copy still had queued (drafts waiting, retries). Past results stay in the history. */
export async function cancelPending(instanceIds: string[]): Promise<number> {
  if (instanceIds.length === 0) return 0;
  const { data } = await supabaseServer.from('automation_actions').update({ status: 'cancelled', refusal_reason: 'automation_removed' }).in('instance_id', instanceIds).in('status', PENDING).select('id');
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length) await supabaseServer.from('automation_approvals').update({ status: 'expired' }).in('action_id', ids).eq('status', 'pending');
  return ids.length;
}

export async function setTemplateActive(ownerId: string, id: string, active: boolean): Promise<void> {
  const { error } = await supabaseServer.from('automation_templates').update({ active, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_user_id', ownerId);
  if (error) throw error;
  // Turning a template off pauses its copies and cancels what they had queued; turning it back on resumes the paused ones.
  if (!active) {
    const { data } = await supabaseServer.from('automation_instances').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('template_id', id).eq('owner_user_id', ownerId).eq('status', 'active').select('id');
    await cancelPending((data ?? []).map((r) => r.id as string));
  } else {
    await supabaseServer.from('automation_instances').update({ status: 'active', updated_at: new Date().toISOString() }).eq('template_id', id).eq('owner_user_id', ownerId).eq('status', 'paused');
  }
}

export async function deleteTemplate(ownerId: string, id: string): Promise<number> {
  const { data } = await supabaseServer.from('automation_instances').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('template_id', id).eq('owner_user_id', ownerId).neq('status', 'removed').select('id');
  const ids = (data ?? []).map((r) => r.id as string);
  await cancelPending(ids);
  const { error } = await supabaseServer.from('automation_templates').delete().eq('id', id).eq('owner_user_id', ownerId);
  if (error) throw error;
  return ids.length;
}

async function ensureSettings(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }): Promise<'created' | 'raised' | 'kept'> {
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const id = (scope.transactionId ?? scope.listingId)!;
  const { data: existing } = await supabaseServer.from('automation_settings').select('id, mode').eq(col, id).maybeSingle();
  if (!existing) {
    const { error } = await supabaseServer.from('automation_settings').insert({ owner_user_id: ownerId, [col]: id, mode: 'draft' });
    if (error) throw error;
    return 'created';
  }
  if (existing.mode === 'off') {
    await supabaseServer.from('automation_settings').update({ mode: 'draft', updated_at: new Date().toISOString() }).eq('id', existing.id);
    return 'raised';
  }
  return 'kept';
}

/** Applies saved automations to one deal or listing: each becomes its own copy. Already-applied ones are left alone. */
export async function assignTemplates(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }, templateIds: string[]) {
  const wanted = [...new Set(templateIds)].slice(0, 20);
  const category = scope.transactionId ? 'transaction' : 'listing';
  const { data: templates } = wanted.length ? await supabaseServer.from('automation_templates').select(TEMPLATE_COLS).in('id', wanted).eq('owner_user_id', ownerId) : { data: [] };
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const scopeId = (scope.transactionId ?? scope.listingId)!;
  const { data: have } = await supabaseServer.from('automation_instances').select('template_id').eq(col, scopeId).neq('status', 'removed');
  const taken = new Set((have ?? []).map((h) => h.template_id as string));
  const applied: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const t of (templates ?? []) as TemplateRow[]) {
    if (t.category !== category) skipped.push({ id: t.id, reason: `That is a ${t.category} automation.` });
    else if (!t.active) skipped.push({ id: t.id, reason: 'It is switched off.' });
    else if (taken.has(t.id)) skipped.push({ id: t.id, reason: 'Already applied.' });
    else {
      const { error } = await supabaseServer.from('automation_instances').insert({
        template_id: t.id, owner_user_id: ownerId, [col]: scopeId, name: t.name, category: t.category, trigger_type: t.trigger_type, steps: t.steps, template_version: t.version,
      });
      if (error) {
        if (error.code === '23505') skipped.push({ id: t.id, reason: 'Already applied.' });
        else throw error;
      } else applied.push(t.id);
    }
  }
  for (const id of wanted) if (!(templates ?? []).some((t) => t.id === id)) skipped.push({ id, reason: 'Not found.' });
  const settings = applied.length ? await ensureSettings(ownerId, scope) : 'kept';
  return { applied, skipped, settings };
}

export async function listInstances(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }) {
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const { data, error } = await supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq(col, (scope.transactionId ?? scope.listingId)!).eq('owner_user_id', ownerId).neq('status', 'removed').order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as InstanceRow[];
}

export async function removeInstance(ownerId: string, id: string): Promise<boolean> {
  const { data } = await supabaseServer.from('automation_instances').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('id', id).eq('owner_user_id', ownerId).neq('status', 'removed').select('id');
  if (!data || data.length === 0) return false;
  await cancelPending([id]);
  return true;
}

/** The explicit "update copies": brings running copies of a template up to its current steps. Never happens by itself. */
export async function updateCopiesFromTemplate(ownerId: string, templateId: string): Promise<number> {
  const t = await getTemplate(ownerId, templateId);
  if (!t) return 0;
  const { data } = await supabaseServer.from('automation_instances').update({ name: t.name, trigger_type: t.trigger_type, steps: t.steps, template_version: t.version, updated_at: new Date().toISOString() }).eq('template_id', templateId).eq('owner_user_id', ownerId).neq('status', 'removed').lt('template_version', t.version).select('id');
  return data?.length ?? 0;
}

export async function history(ownerId: string, filter: { templateId?: string; instanceId?: string; transactionId?: string; listingId?: string }, limit = 50) {
  let ids: string[] | null = null;
  if (filter.templateId) {
    const { data } = await supabaseServer.from('automation_instances').select('id').eq('template_id', filter.templateId).eq('owner_user_id', ownerId);
    ids = (data ?? []).map((r) => r.id as string);
    if (ids.length === 0) return [];
  }
  let q = supabaseServer.from('automation_actions').select('id, kind, status, inputs, result, refusal_reason, created_at, executed_at, instance_id, step_id, transaction_id, listing_id').eq('owner_user_id', ownerId).not('instance_id', 'is', null).order('created_at', { ascending: false }).limit(Math.min(limit, 200));
  if (ids) q = q.in('instance_id', ids);
  if (filter.instanceId) q = q.eq('instance_id', filter.instanceId);
  if (filter.transactionId) q = q.eq('transaction_id', filter.transactionId);
  if (filter.listingId) q = q.eq('listing_id', filter.listingId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ---- The engine step ----------------------------------------------------------------------------------------------

export interface InstancesReport {
  instances: number;
  proposed: number;
  outcomes: Record<string, number>;
  errors: string[];
}

const EVENT_TRIGGERS = new Set(['contract_uploaded', 'document_added', 'deal_closed']);

async function loadFacts(inst: InstanceRow): Promise<{ facts: InstanceFacts; timeZone: string } | null> {
  const col = inst.transaction_id ? 'transaction_id' : 'listing_id';
  const scopeId = (inst.transaction_id ?? inst.listing_id)!;
  const [{ data: settings }, record] = await Promise.all([
    supabaseServer.from('automation_settings').select('time_zone').eq(col, scopeId).maybeSingle(),
    inst.transaction_id
      ? supabaseServer.from('transactions').select('created_at, closing_date, acceptance_date').eq('id', inst.transaction_id).maybeSingle()
      : supabaseServer.from('listings').select('created_at, planned_list_date, expiration_date').eq('id', inst.listing_id!).maybeSingle(),
  ]);
  const r = record.data as Record<string, string | null> | null;
  if (!r) return null;
  const events: Record<string, string | undefined> = {};
  if (inst.transaction_id && EVENT_TRIGGERS.has(inst.trigger_type)) {
    const { data: ev } = await supabaseServer.from('transaction_events').select('occurred_at').eq('transaction_id', inst.transaction_id).eq('type', inst.trigger_type).gte('occurred_at', inst.created_at).order('occurred_at', { ascending: false }).limit(1).maybeSingle();
    if (ev) events[inst.trigger_type] = ev.occurred_at as string;
  }
  const keyDates: Record<string, { date: string; completed: boolean }> = {};
  if (inst.transaction_id && KEY_DATE_KIND_OF[inst.trigger_type]) {
    const { data: kds } = await supabaseServer.from('transaction_key_dates').select('due_date, completed').eq('transaction_id', inst.transaction_id).eq('kind', KEY_DATE_KIND_OF[inst.trigger_type]).order('due_date', { ascending: true });
    // The earliest date still open; if every one is done, the deal's first one (done, so nothing is sent).
    const open = (kds ?? []).find((k) => !k.completed) ?? (kds ?? [])[0];
    if (open) keyDates[KEY_DATE_KIND_OF[inst.trigger_type]] = { date: open.due_date as string, completed: Boolean(open.completed) };
  }
  const timeZone = (settings?.time_zone as string | undefined) ?? DEFAULT_SETTINGS.time_zone;
  return {
    timeZone,
    facts: { createdAt: inst.created_at, timeZone, dealCreatedAt: r.created_at ?? null, closingDate: r.closing_date ?? null, acceptanceDate: r.acceptance_date ?? null, plannedListDate: r.planned_list_date ?? null, expirationDate: r.expiration_date ?? null, events, keyDates },
  };
}

/** Fires whatever is due for every active copy. Safe to run any number of times: each step has a key that includes its anchor. */
export async function runInstances(now: Date, outOfTime: () => boolean, limit = 300): Promise<InstancesReport> {
  const report: InstancesReport = { instances: 0, proposed: 0, outcomes: {}, errors: [] };
  const { data, error } = await supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq('status', 'active').order('updated_at', { ascending: true }).limit(limit);
  if (error) throw error;
  for (const inst of (data ?? []) as InstanceRow[]) {
    if (outOfTime()) break;
    try {
      report.instances++;
      const loaded = await loadFacts(inst);
      if (loaded && triggerOf(inst.trigger_type)) {
        const { data: done } = await supabaseServer.from('automation_actions').select('idempotency_key').eq('instance_id', inst.id).limit(2000);
        const fired = new Set((done ?? []).map((d) => d.idempotency_key as string));
        const due = dueSteps(inst.id, inst.trigger_type, inst.steps, loaded.facts, now, fired);
        if (due.length) {
          const deal = inst.transaction_id ? await loadDealForTemplates(inst.transaction_id) : null;
          const people = deal ? recipientsOf(deal) : [];
          const vars: Record<string, string> = {
            address: deal?.address ?? '',
            file_number: deal?.fileNumber ?? '',
            closing_date: deal?.closingDate ?? '',
            client_name: people.find((p) => /buyer|seller/i.test(p.category))?.name ?? '',
          };
          for (const { step, key } of due) {
            const request = stepToRequest(step, vars, people, loaded.timeZone, now);
            const out = await submitAutomationAction({ ownerUserId: inst.owner_user_id, transactionId: inst.transaction_id, listingId: inst.listing_id, instanceId: inst.id, stepId: step.id, ...request, fromApprovedTemplate: true, idempotencyKey: key });
            if (!out.duplicate) {
              report.proposed++;
              report.outcomes[out.status] = (report.outcomes[out.status] ?? 0) + 1;
            }
          }
        }
      }
    } catch (err) {
      console.error('Automation instance failed:', inst.id, err);
      report.errors.push(`instance ${inst.id}: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 200));
    }
    // updated_at doubles as "last looked at", so the oldest-looked-at copies go first next time.
    await supabaseServer.from('automation_instances').update({ updated_at: now.toISOString() }).eq('id', inst.id);
  }
  return report;
}

export function stepToRequest(step: Step, vars: Record<string, string>, people: { name: string; email: string | null; role: string; category: string }[], timeZone: string, now: Date): { kind: string; inputs: Record<string, unknown> } {
  switch (step.type) {
    case 'send_email':
      return { kind: 'send_deal_email', inputs: { to: resolveRecipients(step.to ?? [], people), subject: fillVars(step.subject ?? '', vars), message: fillVars(step.message ?? '', vars) } };
    case 'create_task': {
      const inputs: Record<string, unknown> = { name: fillVars(step.name ?? '', vars) };
      if (typeof step.dueInDays === 'number') {
        const base = localDayOf(now, timeZone);
        inputs.dueDate = new Date(Date.parse(`${base}T00:00:00Z`) + step.dueInDays * 86_400_000).toISOString().slice(0, 10);
      }
      return { kind: 'create_task', inputs };
    }
    case 'notify_me':
      return { kind: 'notify_user', inputs: { title: fillVars(step.title ?? '', vars), body: fillVars(step.body ?? '', vars) } };
    default:
      return { kind: 'add_note', inputs: { text: fillVars(step.text ?? '', vars) } };
  }
}

export { validateDefinition };
