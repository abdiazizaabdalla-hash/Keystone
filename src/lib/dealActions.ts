import { supabaseServer } from './supabase';
import { computeDueDates, dueDaysToSpec, normalizeDueDateSpec } from './dueDates';
import { statusFromTasks } from './transactionStages';
import { notifyDeal } from './notifications';
import { queueCalendarSync } from './calendarSync';
import { emitDealEvent } from './automation/events';

// Server functions shared by the manual screens and the assistant, so the assistant can do nothing a person could not and
// both behave the same. (Callers decide WHO may call these; these only do the work.)

/** Either anchor date changed: rewrite the computed due_date on every task of the deal. Returns the updated tasks, or null if none. */
export async function recomputeTaskDueDates(transactionId: string, acceptanceDate: string | null, closingDate: string | null) {
  const { data: existingTasks, error } = await supabaseServer
    .from('tasks')
    .select('id, name, due_date_spec, due_days_after_acceptance')
    .eq('transaction_id', transactionId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  if (!existingTasks || existingTasks.length === 0) return null;
  // due_date_spec is the current source of truth; a row saved before it existed only has the legacy due_days_after_acceptance column.
  const dueDates = computeDueDates(
    existingTasks.map((t) => ({
      name: t.name as string,
      dueDate: t.due_date_spec ? normalizeDueDateSpec(t.due_date_spec) : dueDaysToSpec(t.due_days_after_acceptance as number | null),
    })),
    acceptanceDate,
    closingDate
  );
  return Promise.all(
    existingTasks.map(async (t, index) => {
      const { data: updated, error: updateError } = await supabaseServer.from('tasks').update({ due_date: dueDates[index] }).eq('id', t.id as string).select().single();
      if (updateError) throw updateError;
      return updated;
    })
  );
}

/** Sets one contract date on a deal and refreshes the task due dates that depend on it. */
export async function setDealDate(transactionId: string, field: 'acceptance_date' | 'closing_date', date: string) {
  const { data: tx, error } = await supabaseServer.from('transactions').update({ [field]: date, updated_at: new Date().toISOString() }).eq('id', transactionId).select('acceptance_date, closing_date').single();
  if (error) throw error;
  await recomputeTaskDueDates(transactionId, tx.acceptance_date as string | null, tx.closing_date as string | null);
  await emitDealEvent(transactionId, 'date_changed', { acceptanceDate: tx.acceptance_date ?? null, closingDate: tx.closing_date ?? null }, `date_changed:${transactionId}:${tx.acceptance_date ?? ''}:${tx.closing_date ?? ''}`);
  queueCalendarSync(transactionId);
  return tx;
}

/** Marks a step done and keeps the deal's stage in step with the checklist. Returns false if the step is not on that deal. */
export async function completeTask(transactionId: string, taskId: string, actorUserId: string): Promise<boolean> {
  const { data: task } = await supabaseServer.from('tasks').select('id, name, completed').eq('id', taskId).eq('transaction_id', transactionId).maybeSingle();
  if (!task) return false;
  if (!task.completed) {
    const now = new Date().toISOString();
    let { error } = await supabaseServer.from('tasks').update({ completed: true, completed_at: now }).eq('id', taskId);
    // completed_at only exists once add-team-reports.sql has been run.
    if (error && (error.code === '42703' || /completed_at/.test(error.message || ''))) ({ error } = await supabaseServer.from('tasks').update({ completed: true }).eq('id', taskId));
    if (error) throw error;
    await emitDealEvent(transactionId, 'step_ticked', { taskId, name: task.name });
    await notifyDeal({ transactionId, actorUserId, type: 'task_completed', title: 'Step completed', body: task.name as string });
  }
  const { data: all } = await supabaseServer.from('tasks').select('name, completed').eq('transaction_id', transactionId).order('sort_order', { ascending: true });
  const { data: tx } = await supabaseServer.from('transactions').select('status').eq('id', transactionId).single();
  if (all && tx) {
    const next = statusFromTasks(all as { name: string; completed: boolean }[]);
    if (next && tx.status !== next) {
      await supabaseServer.from('transactions').update({ status: next, updated_at: new Date().toISOString() }).eq('id', transactionId);
      await notifyDeal({ transactionId, actorUserId, type: 'stage_changed', title: `Stage moved to ${next}` });
      if (next === 'Closed') await emitDealEvent(transactionId, 'deal_closed', {}, `deal_closed:${transactionId}`);
    }
  }
  queueCalendarSync(transactionId);
  return true;
}
