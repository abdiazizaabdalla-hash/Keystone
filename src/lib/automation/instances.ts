import { loadListingParties } from './listingContext';
import { supabaseServer } from '../supabase';
import { isFeatureOn } from '../features';
import { loadDealForTemplates, recipientsOf, type DealPerson as Person } from '../templateContext';
import { submitAutomationAction } from './actions';
import { refusalText, summarizeAction } from './describe';
import { KEY_DATE_KIND_OF, conditionMet, describeWhen, dueSteps, stepProgress, type SeenAction, type StepProgress, fillVars, missingRecipientRoles, localDayOf, resolveRecipients, triggerOf, validateDefinition, type Definition, type InstanceFacts, type Step } from './library';
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

/**
 * Creates an automation that exists only on this deal or listing (no library entry). The caller has already proven they own it.
 * Returns the new copy, or says what is wrong in words.
 */
export async function createFileAutomation(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }, input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const checked = validateDefinition(input);
  if (!checked.ok) return checked;
  const def = checked.value;
  const category = scope.transactionId ? 'transaction' : 'listing';
  if (def.category !== category) return { ok: false, error: `This is a ${category}; that is a ${def.category} automation.` };
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const scopeId = (scope.transactionId ?? scope.listingId)!;
  const { data, error } = await supabaseServer.from('automation_instances').insert({ template_id: null, owner_user_id: ownerId, [col]: scopeId, name: def.name, category, trigger_type: def.triggerType, steps: def.steps, template_version: 1 }).select('id').single();
  if (error) throw error;
  await ensureSettings(ownerId, scope);
  return { ok: true, id: data.id as string };
}

/**
 * Edits one copy on one file: its name and steps. When it starts (the trigger) cannot change here, because a different start
 * date would make steps that already ran look new. Steps that were removed lose anything they had queued; steps that already
 * ran are not run again.
 */
export async function updateInstanceDefinition(ownerId: string, id: string, input: unknown): Promise<{ ok: true } | { ok: false; error: string; notFound?: boolean }> {
  const { data } = await supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq('id', id).eq('owner_user_id', ownerId).neq('status', 'removed').maybeSingle();
  if (!data) return { ok: false, error: 'Automation not found', notFound: true };
  const inst = data as InstanceRow;
  const checked = validateDefinition(input);
  if (!checked.ok) return checked;
  const def = checked.value;
  if (def.category !== inst.category) return { ok: false, error: 'The type of an automation cannot change.' };
  if (def.triggerType !== inst.trigger_type) return { ok: false, error: 'What an automation starts from cannot be changed on a file. Create a new one instead.' };
  const { error } = await supabaseServer.from('automation_instances').update({ name: def.name, steps: def.steps, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_user_id', ownerId);
  if (error) throw error;
  const keep = new Set(def.steps.map((x) => x.id));
  const gone = inst.steps.map((x) => x.id).filter((x) => !keep.has(x));
  if (gone.length) {
    const { data: cut } = await supabaseServer.from('automation_actions').update({ status: 'cancelled', refusal_reason: 'automation_removed' }).eq('instance_id', id).in('step_id', gone).in('status', PENDING).select('id');
    const ids = (cut ?? []).map((r) => r.id as string);
    if (ids.length) await supabaseServer.from('automation_approvals').update({ status: 'expired' }).in('action_id', ids).eq('status', 'pending');
  }
  return { ok: true };
}

export async function listInstances(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }) {
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const { data, error } = await supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq(col, (scope.transactionId ?? scope.listingId)!).eq('owner_user_id', ownerId).neq('status', 'removed').order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as InstanceRow[];
  // Live check against the people on the deal right now, so a missing Lender shows up (and goes away) as contacts change.
  const wantsEmail = rows.some((r) => r.steps.some((s) => s.type === 'send_email'));
  const deal = scope.transactionId && wantsEmail ? await loadDealForTemplates(scope.transactionId) : null;
  const listing = scope.listingId && wantsEmail ? await loadListingParties(scope.listingId) : null;
  const people = deal ? recipientsOf(deal) : listing ? listing.people : [];
  const known = Boolean(deal || listing);
  return rows.map((r) => ({ ...r, missingRoles: known ? missingRecipientRoles(r.steps, people) : [] }));
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
      ? supabaseServer.from('transactions').select('*').eq('id', inst.transaction_id).maybeSingle()
      : supabaseServer.from('listings').select('created_at, planned_list_date, expiration_date').eq('id', inst.listing_id!).maybeSingle(),
  ]);
  const r = record.data as Record<string, string | null> | null;
  if (!r) return null;
  // An archived deal is no longer being worked: its automations do nothing until it is restored.
  if (inst.transaction_id && r.archived_at) return null;
  const events: Record<string, string | undefined> = {};
  if (inst.transaction_id && EVENT_TRIGGERS.has(inst.trigger_type)) {
    const { data: ev } = await supabaseServer.from('transaction_events').select('occurred_at').eq('transaction_id', inst.transaction_id).eq('type', inst.trigger_type).gte('occurred_at', inst.created_at).order('occurred_at', { ascending: false }).limit(1).maybeSingle();
    if (ev) events[inst.trigger_type] = ev.occurred_at as string;
  }
  if (inst.listing_id && inst.trigger_type === 'offer_received') {
    // Offers have no event log of their own; the offer rows are the record. The latest one added after this copy was applied.
    const { data: off } = await supabaseServer.from('listing_offers').select('created_at').eq('listing_id', inst.listing_id).gte('created_at', inst.created_at).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (off) events.offer_received = off.created_at as string;
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

interface StepContext {
  vars: Record<string, string>;
  people: Person[];
  ctx: { keyDates: { kind: string; completed: boolean }[]; people: Person[]; documents: string[] };
}

/** What a copy's steps are filled in from, and what their "only if" conditions are checked against, as the file is right now. */
async function stepContext(inst: InstanceRow, withConditions: boolean): Promise<StepContext> {
  const deal = inst.transaction_id ? await loadDealForTemplates(inst.transaction_id) : null;
  const listing = inst.listing_id ? await loadListingParties(inst.listing_id) : null;
  const people = deal ? recipientsOf(deal) : listing ? listing.people : [];
  const vars: Record<string, string> = {
    address: deal?.address ?? listing?.address ?? '',
    file_number: deal?.fileNumber ?? '',
    closing_date: deal?.closingDate ?? '',
    client_name: people.find((p) => /buyer|seller/i.test(p.category))?.name ?? listing?.sellerName ?? '',
  };
  let ctx: StepContext['ctx'] = { keyDates: [], people, documents: [] };
  if (withConditions && inst.transaction_id) {
    const [{ data: kds }, { data: docs }] = await Promise.all([
      supabaseServer.from('transaction_key_dates').select('kind, completed').eq('transaction_id', inst.transaction_id),
      supabaseServer.from('documents').select('document_type, file_name').eq('transaction_id', inst.transaction_id),
    ]);
    ctx = { keyDates: (kds ?? []).map((k) => ({ kind: k.kind as string, completed: Boolean(k.completed) })), people, documents: (docs ?? []).map((d) => `${d.document_type ?? ''} ${d.file_name ?? ''}`.toLowerCase()) };
  }
  return { vars, people, ctx };
}

/** Fires whatever is due for every active copy. Safe to run any number of times: each step has a key that includes its anchor. */
export async function runInstances(now: Date, outOfTime: () => boolean, limit = 300, only?: { transactionId?: string | null; listingId?: string | null }): Promise<InstancesReport> {
  const report: InstancesReport = { instances: 0, proposed: 0, outcomes: {}, errors: [] };
  let q = supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq('status', 'active');
  if (only?.transactionId) q = q.eq('transaction_id', only.transactionId);
  if (only?.listingId) q = q.eq('listing_id', only.listingId);
  const { data, error } = await q.order('updated_at', { ascending: true }).limit(limit);
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
          // "Only if" conditions are checked now, against the file as it is. A step whose condition is false is simply not done;
          // it is checked again on later runs until it is too old to send.
          const { vars, people, ctx } = await stepContext(inst, due.some((d) => d.step.condition));
          for (const { step, key } of due) {
            if (!conditionMet(step.condition, ctx)) continue;
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

// ---- The tracker: what each step did, or when it will; running one by hand; pausing a copy ------------------------------

export interface TrackedStep {
  id: string;
  type: string;
  /** "3 days before closing date" */
  when: string;
  /** What it does, in a line ("Welcome to {address} to a@b.com"). */
  what: string;
  state: StepProgress['state'];
  due: string | null;
  note: string;
  lastAt: string | null;
  manual: boolean;
  /** A draft waiting for the person: its action id, so the tracker can approve or reject it. */
  pendingActionId: string | null;
  /** For an email that went out: what it said and where it went. `mode` is 'outbox' on a test machine (saved, not sent). */
  sent: { to: string[]; subject: string; message: string; mode: string } | null;
}
export interface TrackedInstance {
  id: string;
  templateId: string | null;
  name: string;
  trigger: string;
  triggerLabel: string;
  status: string;
  category: 'transaction' | 'listing';
  /** The steps as saved (for editing), as opposed to `steps`, which is what the tracker shows for each. */
  definition: Step[];
  missingRoles: string[];
  done: number;
  total: number;
  steps: TrackedStep[];
}

export async function progressFor(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }, now: Date = new Date()): Promise<TrackedInstance[]> {
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const { data, error } = await supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq(col, (scope.transactionId ?? scope.listingId)!).eq('owner_user_id', ownerId).neq('status', 'removed').order('created_at', { ascending: true });
  if (error) throw error;
  const out: TrackedInstance[] = [];
  for (const inst of (data ?? []) as InstanceRow[]) {
    const trig = triggerOf(inst.trigger_type);
    const [loaded, { data: acts }, sc] = await Promise.all([
      loadFacts(inst),
      supabaseServer.from('automation_actions').select('id, step_id, idempotency_key, status, refusal_reason, created_at, executed_at, kind, inputs, result').eq('instance_id', inst.id).order('created_at', { ascending: false }).limit(500),
      stepContext(inst, inst.steps.some((s) => s.condition)),
    ]);
    const rows = acts ?? [];
    const seen: SeenAction[] = rows.map((a) => ({ stepId: a.step_id as string | null, key: a.idempotency_key as string | null, status: a.status as string, at: (a.executed_at ?? a.created_at) as string, reason: a.refusal_reason as string | null }));
    const tz = loaded?.timeZone ?? DEFAULT_SETTINGS.time_zone;
    const progress: StepProgress[] = loaded
      ? stepProgress(inst.id, inst.trigger_type, inst.steps, loaded.facts, now, seen, (st) => conditionMet(st.condition, sc.ctx), refusalText)
      : inst.steps.map((st) => ({ stepId: st.id, state: 'waiting_trigger' as const, due: null, note: 'This file could not be read.', lastAt: null, manual: false }));
    const steps: TrackedStep[] = inst.steps.map((st) => {
      const pr = progress.find((x) => x.stepId === st.id)!;
      const req = stepToRequest(st, sc.vars, sc.people, tz, now);
      const pending = rows.find((a) => a.step_id === st.id && a.status === 'awaiting_approval');
      const out = rows.find((a) => a.step_id === st.id && a.status === 'executed' && (a.kind === 'send_deal_email' || a.kind === 'send_step_email'));
      const outIn = (out?.inputs ?? {}) as Record<string, unknown>;
      const outRes = (out?.result ?? {}) as Record<string, unknown>;
      const sent: TrackedStep['sent'] = out ? { to: Array.isArray(outRes.to) ? (outRes.to as string[]) : Array.isArray(outIn.to) ? (outIn.to as string[]) : [], subject: String(outIn.subject ?? ''), message: String(outIn.message ?? ''), mode: String(outRes.mode ?? 'sent') } : null;
      return {
        id: st.id, type: st.type, when: describeWhen(st, trig?.label ?? 'the trigger'), what: summarizeAction(req.kind, req.inputs),
        state: pr.state, due: pr.due, note: pr.note, lastAt: pr.lastAt, manual: pr.manual, pendingActionId: pending ? (pending.id as string) : null, sent,
      };
    });
    out.push({
      id: inst.id, templateId: inst.template_id, name: inst.name, trigger: inst.trigger_type, triggerLabel: trig?.label ?? inst.trigger_type, status: inst.status, category: inst.category, definition: inst.steps,
      missingRoles: inst.steps.some((st) => st.type === 'send_email') ? missingRecipientRoles(inst.steps, sc.people) : [],
      done: steps.filter((x) => x.state === 'done').length, total: steps.length, steps,
    });
  }
  return out;
}

export type RunNowResult =
  | { ok: true; results: { stepId: string; status: string; message: string | null; actionId: string | null }[] }
  | { ok: false; reason: 'not_found' | 'not_active' | 'unknown_step' };

const RUN_AGAIN_AFTER_MS = 15_000; // a double click must not send twice

/**
 * Runs steps of one copy right now, whatever their schedule or "only if". Everything still goes through the guard: the
 * assistant's mode, the allowed recipients, the daily cap and approval in Draft. One step, or every step not yet handled.
 */
export async function runNow(ownerId: string, instanceId: string, stepId: string | null, now: Date = new Date()): Promise<RunNowResult> {
  const { data } = await supabaseServer.from('automation_instances').select(INSTANCE_COLS).eq('id', instanceId).eq('owner_user_id', ownerId).neq('status', 'removed').maybeSingle();
  if (!data) return { ok: false, reason: 'not_found' };
  const inst = data as InstanceRow;
  if (inst.status !== 'active') return { ok: false, reason: 'not_active' };
  let steps = inst.steps;
  if (stepId) {
    steps = inst.steps.filter((x) => x.id === stepId);
    if (steps.length === 0) return { ok: false, reason: 'unknown_step' };
  } else {
    const tracked = (await progressFor(ownerId, { transactionId: inst.transaction_id, listingId: inst.listing_id }, now)).find((t) => t.id === inst.id);
    const finished = new Set(tracked?.steps.filter((x) => ['done', 'needs_ok', 'waiting'].includes(x.state)).map((x) => x.id));
    steps = inst.steps.filter((x) => !finished.has(x.id));
  }
  const loaded = await loadFacts(inst);
  const tz = loaded?.timeZone ?? DEFAULT_SETTINGS.time_zone;
  const sc = await stepContext(inst, false);
  const since = new Date(now.getTime() - RUN_AGAIN_AFTER_MS).toISOString();
  const results: { stepId: string; status: string; message: string | null; actionId: string | null }[] = [];
  for (const st of steps) {
    const { data: recent } = await supabaseServer.from('automation_actions').select('id').eq('instance_id', inst.id).eq('step_id', st.id).like('idempotency_key', `inst:${inst.id}:${st.id}:manual:%`).gte('created_at', since).limit(1);
    if (recent && recent.length) {
      results.push({ stepId: st.id, status: 'already_running', message: 'That was just run.', actionId: recent[0].id as string });
      continue;
    }
    const request = stepToRequest(st, sc.vars, sc.people, tz, now);
    const out = await submitAutomationAction({ ownerUserId: inst.owner_user_id, transactionId: inst.transaction_id, listingId: inst.listing_id, instanceId: inst.id, stepId: st.id, ...request, fromApprovedTemplate: true, idempotencyKey: `inst:${inst.id}:${st.id}:manual:${now.getTime()}` });
    const reason = out.decision && out.decision.outcome === 'refuse' ? (out.decision.detail ? `${out.decision.reason}:${out.decision.detail}` : out.decision.reason) : null;
    results.push({ stepId: st.id, status: out.status, message: reason ? refusalText(reason) : null, actionId: out.actionId });
  }
  return { ok: true, results };
}

/** Pause or resume one copy on one file. Pausing also cancels what it had queued; what already happened stays in the history. */
export async function setInstanceStatus(ownerId: string, id: string, status: 'active' | 'paused'): Promise<boolean> {
  const { data } = await supabaseServer.from('automation_instances').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_user_id', ownerId).neq('status', 'removed').select('id');
  if (!data || data.length === 0) return false;
  if (status === 'paused') await cancelPending([id]);
  return true;
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

/**
 * Runs what is due on ONE deal or listing right now, so a draft email reaches the owner for approval the moment something happens
 * (an automation is added, a contract or document arrives, an offer comes in) instead of at the next hourly check. Never throws:
 * the hourly check will catch anything this misses.
 */
export async function runInstancesFor(scope: { transactionId?: string | null; listingId?: string | null }): Promise<void> {
  try {
    if (!isFeatureOn('automation') || (!scope.transactionId && !scope.listingId)) return;
    await runInstances(new Date(), () => false, 25, scope);
  } catch (err) {
    console.error('Immediate automation run failed:', err);
  }
}

/** The same, for the file one copy lives on (after it is edited or resumed). */
export async function runInstancesForCopy(ownerId: string, instanceId: string): Promise<void> {
  const { data } = await supabaseServer.from('automation_instances').select('transaction_id, listing_id').eq('id', instanceId).eq('owner_user_id', ownerId).maybeSingle();
  if (data) await runInstancesFor({ transactionId: data.transaction_id as string | null, listingId: data.listing_id as string | null });
}

