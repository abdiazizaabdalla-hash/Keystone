import { supabaseServer } from './supabase';
import { completedCountForStatus } from './transactionStages';

/**
 * Bulk-syncs a transaction's tasks (ordered by sort_order) to match a given
 * status — marks the first N tasks complete and the rest incomplete, where
 * N = completedCountForStatus(status, <this transaction's own task names>).
 * Used when status changes manually. Reads the task names itself (rather
 * than taking a pre-computed count) so it always derives N against this
 * transaction's own checklist, whether that's the baseline template or a
 * custom one.
 */
export async function syncTasksToStatus(transactionId: string, status: string) {
  const { data: tasks, error } = await supabaseServer
    .from('tasks')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('sort_order', { ascending: true });

  if (error || !tasks) return [];

  const targetCompletedCount = completedCountForStatus(status, tasks.map((t) => t.name));

  const toComplete = tasks.slice(0, targetCompletedCount).filter((t) => !t.completed).map((t) => t.id);
  const toReopen = tasks.slice(targetCompletedCount).filter((t) => t.completed).map((t) => t.id);

  if (toComplete.length) {
    await supabaseServer.from('tasks').update({ completed: true }).in('id', toComplete);
  }
  if (toReopen.length) {
    await supabaseServer.from('tasks').update({ completed: false }).in('id', toReopen);
  }

  // Reflect the writes locally instead of re-querying — the caller can hand
  // this straight back to the frontend so it can update state without a
  // second round trip.
  const completeSet = new Set(toComplete);
  const reopenSet = new Set(toReopen);
  return tasks.map((t) => {
    if (completeSet.has(t.id)) return { ...t, completed: true };
    if (reopenSet.has(t.id)) return { ...t, completed: false };
    return t;
  });
}
