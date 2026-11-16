// Brokerage required steps: the checklist a broker sets once for every agent's transactions and listings. Pure (no database).

export const REQUIRED_STEP_KINDS = ['transaction', 'listing'] as const;
export type StepKind = (typeof REQUIRED_STEP_KINDS)[number];
export const isStepKind = (v: unknown): v is StepKind => (REQUIRED_STEP_KINDS as readonly string[]).includes(String(v));
export const MAX_REQUIRED_STEPS = 20;
export const STEP_NAME_MAX = 60;

import { TASK_TEMPLATE } from './transactionStages';
import { BASELINE_DUE_DATE_SUGGESTIONS } from './dueDates';
import { DEFAULT_LISTING_STEPS } from './listingsShared';

export interface RequiredStep { name: string; dueDays: number | null }

/**
 * Relay's own starting checklists, shown in the editor until the owner saves their own. A transaction step keeps its day count only when it is
 * counted from acceptance (the others are counted from closing, which this list does not express, so they have no day here). A listing step
 * counts from the planned list date, and a negative number means before it.
 */
export const DEFAULT_REQUIRED_STEPS: Record<StepKind, RequiredStep[]> = {
  transaction: TASK_TEMPLATE.map((name) => {
    const spec = BASELINE_DUE_DATE_SUGGESTIONS[name];
    return { name, dueDays: spec && spec.mode === 'after_acceptance' ? (spec.days ?? null) : null };
  }),
  listing: DEFAULT_LISTING_STEPS.map((s) => ({ name: s.name, dueDays: s.offsetDays })),
};

/** The steps a person sent: trimmed names, no blanks or repeats (ignoring case), days kept to 0-365, at most 20. */
export function cleanRequiredSteps(input: unknown, kind?: StepKind): RequiredStep[] {
  const low = kind === 'listing' ? -365 : 0;
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: RequiredStep[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ').slice(0, STEP_NAME_MAX) : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const n = r.dueDays === null || r.dueDays === '' || r.dueDays === undefined ? NaN : Number(r.dueDays);
    out.push({ name, dueDays: Number.isFinite(n) ? Math.min(365, Math.max(low, Math.round(n))) : null });
    if (out.length >= MAX_REQUIRED_STEPS) break;
  }
  return out;
}

/** The required steps a file does not have yet (same name, ignoring case, counts as having it). */
export function stepsToAdd(existingNames: string[], required: RequiredStep[]): RequiredStep[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return required.filter((s) => !have.has(s.name.toLowerCase()));
}
