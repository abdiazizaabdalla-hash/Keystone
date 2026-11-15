import { supabaseServer } from './supabase';
import { CLOSED_STAGE, brokerageOwnersForAgent, listOwnerLinks, isOpenListing } from './oversight';
import { stepsToAdd, type RequiredStep, type StepKind } from './brokerageRequiredStepsRules';

export * from './brokerageRequiredStepsRules';

// Adds a brokerage's required steps to its agents' files. Best effort: a problem here never stops a deal or listing from being created.

const missingTable = (e: { code?: string } | null | undefined) => e?.code === 'PGRST205' || e?.code === '42P01';
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function loadRequiredSteps(ownerId: string, kind?: StepKind): Promise<Record<StepKind, RequiredStep[]>> {
  let q = supabaseServer.from('brokerage_required_steps').select('kind, name, due_days').eq('owner_user_id', ownerId).order('position', { ascending: true });
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  const out: Record<StepKind, RequiredStep[]> = { transaction: [], listing: [] };
  if (error) {
    if (missingTable(error)) return out;
    throw error;
  }
  for (const r of data ?? []) out[r.kind as StepKind].push({ name: r.name as string, dueDays: r.due_days === null ? null : Number(r.due_days) });
  return out;
}

/** Adds the steps the file lacks. Returns how many were added. */
async function addToFile(kind: StepKind, fileId: string, required: RequiredStep[], startDate: string | null): Promise<number> {
  if (required.length === 0) return 0;
  if (kind === 'transaction') {
    const { data: existing, error } = await supabaseServer.from('tasks').select('name, sort_order').eq('transaction_id', fileId);
    if (error) throw error;
    const add = stepsToAdd((existing ?? []).map((t) => String(t.name)), required);
    if (add.length === 0) return 0;
    let order = Math.max(-1, ...(existing ?? []).map((t) => Number(t.sort_order) || 0));
    const rows = add.map((s) => ({
      transaction_id: fileId, name: s.name, completed: false, sort_order: ++order,
      due_date: s.dueDays !== null && startDate ? addDays(startDate, s.dueDays) : null,
      due_date_spec: s.dueDays !== null ? { mode: 'after_acceptance', days: s.dueDays } : { mode: 'none' },
      due_days_after_acceptance: s.dueDays,
    }));
    const { error: insErr } = await supabaseServer.from('tasks').insert(rows);
    if (insErr) throw insErr;
    return rows.length;
  }
  const { data: existing, error } = await supabaseServer.from('listing_tasks').select('name, sort_order').eq('listing_id', fileId);
  if (error) throw error;
  const add = stepsToAdd((existing ?? []).map((t) => String(t.name)), required);
  if (add.length === 0) return 0;
  let order = Math.max(-1, ...(existing ?? []).map((t) => Number(t.sort_order) || 0));
  const rows = add.map((s) => ({ listing_id: fileId, name: s.name, offset_days: s.dueDays, due_date: s.dueDays !== null && startDate ? addDays(startDate, s.dueDays) : null, sort_order: ++order }));
  const { error: insErr } = await supabaseServer.from('listing_tasks').insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}

/** For a file just created by an agent in a brokerage: add the brokerage's required steps. Never throws. */
export async function applyRequiredStepsToNewFile(kind: StepKind, fileId: string, agentUserId: string, startDate: string | null): Promise<void> {
  try {
    for (const ownerId of await brokerageOwnersForAgent(agentUserId)) {
      const required = (await loadRequiredSteps(ownerId, kind))[kind];
      await addToFile(kind, fileId, required, startDate);
    }
  } catch (error) {
    console.error('Could not add the brokerage required steps:', error);
  }
}

/** "Add to files already open": every open deal and listing of the brokerage's active agents gets the steps it lacks. */
export async function applyRequiredStepsToOpenFiles(ownerId: string): Promise<{ deals: number; listings: number; steps: number }> {
  const steps = await loadRequiredSteps(ownerId);
  const agentIds = (await listOwnerLinks(ownerId)).filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
  const out = { deals: 0, listings: 0, steps: 0 };
  if (agentIds.length === 0) return out;
  if (steps.transaction.length) {
    const { data, error } = await supabaseServer.from('transactions').select('id, status, acceptance_date').in('tc_user_id', agentIds).is('archived_at', null).limit(2000);
    if (error) throw error;
    for (const d of (data ?? []).filter((x) => x.status !== CLOSED_STAGE)) {
      const n = await addToFile('transaction', d.id as string, steps.transaction, (d.acceptance_date as string | null) ?? null);
      if (n) { out.deals += 1; out.steps += n; }
    }
  }
  if (steps.listing.length) {
    const { data, error } = await supabaseServer.from('listings').select('id, status, planned_list_date').in('tc_user_id', agentIds).is('archived_at', null).limit(2000);
    if (error) throw error;
    for (const l of (data ?? []).filter((x) => isOpenListing(x.status as string))) {
      const n = await addToFile('listing', l.id as string, steps.listing, (l.planned_list_date as string | null) ?? null);
      if (n) { out.listings += 1; out.steps += n; }
    }
  }
  return out;
}
