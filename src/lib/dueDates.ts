import { TASK_TEMPLATE } from './transactionStages';

/**
 * Checklist due dates come from a per-step "due date spec" that the TC
 * actually chooses -- at transaction-creation time for every step
 * (baseline included), and when building/editing a custom template --
 * kept as an explicit choice rather than a silent hardcoded assumption.
 * See BASELINE_DUE_DATE_SUGGESTIONS below for the values used to pre-fill
 * that choice; they're only ever a starting point shown in the UI, never
 * applied on their own.
 *
 * A step's chosen spec is snapshotted onto its `tasks` row at creation
 * time (the `due_date_spec` column) rather than looked up from the
 * template again later, matching how the task's own `name` is already a
 * point-in-time snapshot -- editing or deleting a template never
 * retroactively changes an existing transaction's checklist.
 *
 * Older rows saved before this feature existed only have the legacy
 * `due_days_after_acceptance` column set -- dueDaysToSpec() below converts
 * that into the current shape so they keep working without a data
 * migration.
 *
 * Off by default at the account level (see dueDateWorkflowEnabled in
 * /api/auth/me) -- a TC who hasn't set anything up gets no due dates
 * rather than one silently assumed. This manual DueDateSpec is the entry
 * point a future AI-extraction feature (pulling deadlines straight off an
 * uploaded contract) would also write to -- same shape, same
 * computeDueDates, just a different source for the spec.
 */

export type DueDateMode = 'none' | 'after_acceptance' | 'before_closing' | 'after_closing' | 'fixed';

export interface DueDateSpec {
  mode: DueDateMode;
  /** Day count for after_acceptance / before_closing / after_closing -- always stored non-negative. */
  days?: number | null;
  /** ISO 'YYYY-MM-DD', used only when mode is 'fixed'. */
  fixedDate?: string | null;
}

export const NO_DUE_DATE: DueDateSpec = { mode: 'none' };

/** How far out a step's day-count due date can be pushed. */
export const MAX_DUE_DATE_DAYS = 365;

const FIXED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates/normalizes an arbitrary value (e.g. straight from request JSON
 * or a DB row) into a safe DueDateSpec, falling back to "no due date" for
 * anything unusable rather than throwing.
 */
export function normalizeDueDateSpec(raw: unknown): DueDateSpec {
  if (!raw || typeof raw !== 'object') return { ...NO_DUE_DATE };
  const mode = (raw as { mode?: unknown }).mode;

  if (mode === 'fixed') {
    const fixedDate = (raw as { fixedDate?: unknown }).fixedDate;
    return typeof fixedDate === 'string' && FIXED_DATE_RE.test(fixedDate)
      ? { mode: 'fixed', fixedDate }
      : { ...NO_DUE_DATE };
  }

  if (mode === 'after_acceptance' || mode === 'before_closing' || mode === 'after_closing') {
    const rawDays = (raw as { days?: unknown }).days;
    const days =
      typeof rawDays === 'number' && Number.isFinite(rawDays)
        ? Math.max(0, Math.min(MAX_DUE_DATE_DAYS, Math.round(Math.abs(rawDays))))
        : 0;
    return { mode, days };
  }

  return { ...NO_DUE_DATE };
}

/**
 * Converts a legacy numeric `dueDays` (days after acceptance -- the only
 * shape this feature supported before per-step due-date modes existed)
 * into the current spec shape.
 */
export function dueDaysToSpec(days: number | null | undefined): DueDateSpec {
  return typeof days === 'number' && Number.isFinite(days)
    ? { mode: 'after_acceptance', days: Math.max(0, Math.min(MAX_DUE_DATE_DAYS, Math.round(Math.abs(days)))) }
    : { ...NO_DUE_DATE };
}

/**
 * Suggested starting points shown when a TC picks the Baseline checklist --
 * ordinary contingency-period conventions (10-day inspection period,
 * 21-day appraisal, etc.), not anything transaction-specific. These are
 * pure defaults for pre-filling the due-date picker at transaction
 * creation; they're never computed/applied silently.
 */
export const BASELINE_DUE_DATE_SUGGESTIONS: Record<string, DueDateSpec> = {
  'Contract & File Setup': { mode: 'after_acceptance', days: 1 },
  'Earnest Money & Option': { mode: 'after_acceptance', days: 3 },
  'Inspection & Repairs': { mode: 'after_acceptance', days: 10 },
  'Title, Appraisal & Financing': { mode: 'after_acceptance', days: 21 },
  'Clear to Close': { mode: 'before_closing', days: 2 },
  'Closing & Post-Closing': { mode: 'after_closing', days: 0 },
};

/** True if every one of these names is exactly the baseline 6-step checklist, in order. */
export function isBaselineChecklist(taskNames: string[]): boolean {
  return taskNames.length === TASK_TEMPLATE.length && taskNames.every((name, i) => name === TASK_TEMPLATE[i]);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export interface DueDateTaskInput {
  name: string;
  /** This task's own due-date rule, snapshotted at creation time (see module doc above). */
  dueDate?: DueDateSpec | null;
}

/**
 * Computes each task's due date (as an ISO 'YYYY-MM-DD' string, or null)
 * from its own explicitly-chosen spec and the transaction's anchor dates.
 * Returns one entry per task, same order as input -- pure function, no DB
 * access, so it's easy to call both at transaction/checklist-template
 * creation and whenever acceptance_date/closing_date changes later.
 */
export function computeDueDates(
  tasks: DueDateTaskInput[],
  acceptanceDate: string | null,
  closingDate: string | null
): (string | null)[] {
  return tasks.map((task) => {
    const spec = task.dueDate;
    if (!spec || spec.mode === 'none') return null;

    if (spec.mode === 'fixed') {
      return spec.fixedDate || null;
    }

    const days = typeof spec.days === 'number' ? Math.abs(spec.days) : 0;
    if (spec.mode === 'after_acceptance') {
      return acceptanceDate ? addDays(acceptanceDate, days) : null;
    }
    if (spec.mode === 'before_closing') {
      return closingDate ? addDays(closingDate, -days) : null;
    }
    if (spec.mode === 'after_closing') {
      return closingDate ? addDays(closingDate, days) : null;
    }
    return null;
  });
}

// Formats a date or timestamp value for display so the calendar date
// shown never depends on the viewer's (or the server's) local timezone.
// Guards against two independent gotchas seen across this codebase:
//
// 1. A DATE-only string ("2026-10-30", e.g. tasks.due_date,
//    invoices.due_date) is UTC midnight once parsed by `new Date(...)`,
//    but `.toLocaleDateString()` without an explicit timeZone renders in
//    the browser's local zone -- shifting the displayed date back a day
//    for anyone west of UTC (i.e. almost all of the US).
// 2. A TIMESTAMP WITHOUT TIME ZONE column (invoices.invoice_date,
//    paid_at, refunded_at, ...) comes back from Postgres/PostgREST with
//    no offset (e.g. "2026-09-30T05:06:43.285"), which `new Date(...)`
//    then parses as *local* time instead of the UTC wall-clock reading
//    it actually is -- see the identical parseUtc() in lib/trial.ts.
//
// Fixing both: treat any offset-less string as UTC when parsing (append
// 'Z' if nothing's already there), then format with timeZone: 'UTC'.
export function formatDisplayDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', year: 'numeric' }
): string {
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  const date = new Date(hasOffset ? value : `${value}Z`);
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}
