// The transaction checklist (tasks) and the transaction status are kept in
// sync automatically: completing tasks in order advances the status, and
// manually changing the status checks off (or unchecks) tasks to match.
//
// TRANSACTION_STAGES has exactly one more entry than TASK_TEMPLATE — the
// leading "Contract Pending" stage represents zero tasks completed yet.
// This is the hand-curated "baseline" checklist every account gets for
// free; TCs on Pro/Team can also build their own checklist templates
// (see checklistTemplates.ts) with their own step names, in which case the
// status labels are derived generically instead -- see stagesForTaskNames.
export const TRANSACTION_STAGES = [
  'Contract Pending',
  'Contract & File Setup',
  'Earnest Money & Option',
  'Inspection & Repairs',
  'Title, Appraisal & Financing',
  'Clear to Close',
  'Closed',
];

export const TASK_TEMPLATE = [
  'Contract & File Setup',
  'Earnest Money & Option',
  'Inspection & Repairs',
  'Title, Appraisal & Financing',
  'Clear to Close',
  'Closing & Post-Closing',
];

/**
 * Derives the ordered list of status labels ("stages") a transaction moves
 * through, given the names of its own checklist tasks (in order). A
 * transaction's tasks are a fixed snapshot taken at creation time from
 * whichever checklist template was used, so this always reflects that
 * transaction's own checklist rather than a single global list.
 *
 * - If the task names exactly match the baseline TASK_TEMPLATE, the
 *   hand-curated TRANSACTION_STAGES labels are used (unchanged behavior
 *   for every existing transaction and the default for new ones).
 * - Otherwise (a custom checklist template), stages are derived
 *   generically: "Contract Pending" before anything is done, "Closed" once
 *   every task is done, and each in-between stage named after the task
 *   that was just completed to reach it. 'Contract Pending' and 'Closed'
 *   are load-bearing sentinel strings several other files match on
 *   (invoice auto-creation, plan limits, dashboards) — every template,
 *   baseline or custom, must produce exactly those two as its first and
 *   last stage.
 */
export function stagesForTaskNames(names: string[]): string[] {
  if (
    names.length === TASK_TEMPLATE.length &&
    names.every((name, i) => name === TASK_TEMPLATE[i])
  ) {
    return TRANSACTION_STAGES;
  }
  if (names.length === 0) return ['Contract Pending', 'Closed'];
  return ['Contract Pending', ...names.slice(0, -1), 'Closed'];
}

/**
 * Derives the transaction status from an ordered list of tasks. Counts how
 * many tasks are completed contiguously from the start of the list, so
 * checking a later task out of order doesn't jump the status ahead. Uses
 * the tasks' own names to pick the right stage labels (baseline or a
 * custom template) via stagesForTaskNames.
 */
export function statusFromTasks(orderedTasks: { name?: string; completed: boolean }[]): string {
  let count = 0;
  for (const task of orderedTasks) {
    if (task.completed) count++;
    else break;
  }
  const stages = stagesForTaskNames(orderedTasks.map((t) => t.name ?? ''));
  return stages[Math.min(count, stages.length - 1)];
}

/**
 * How many of the (ordered) tasks should be marked complete for a given
 * status. Pass the transaction's own task names so a custom checklist's
 * stages are used instead of the baseline ones when applicable; omit it
 * (or pass the baseline names) to fall back to TRANSACTION_STAGES.
 */
export function completedCountForStatus(status: string, taskNames?: string[]): number {
  const stages = taskNames ? stagesForTaskNames(taskNames) : TRANSACTION_STAGES;
  const idx = stages.indexOf(status);
  return idx === -1 ? 0 : idx;
}
