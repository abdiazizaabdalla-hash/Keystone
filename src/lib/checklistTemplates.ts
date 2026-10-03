import { TASK_TEMPLATE } from './transactionStages';
import { DueDateSpec, BASELINE_DUE_DATE_SUGGESTIONS, NO_DUE_DATE, normalizeDueDateSpec, dueDaysToSpec } from './dueDates';

export const BASELINE_TEMPLATE_ID = 'baseline';

export const MAX_TEMPLATE_STEPS = 20;
export const MAX_TEMPLATE_NAME_LENGTH = 60;
export const MAX_STEP_NAME_LENGTH = 60;

export interface ChecklistTemplateStep {
  name: string;
  /**
   * This step's due-date rule, chosen explicitly by the TC when building
   * the template rather than assumed -- also used to pre-fill the same
   * choice at transaction-creation time, where it can be adjusted per
   * deal. See lib/dueDates.ts for the full DueDateSpec shape and
   * computeDueDates. Omitted/absent means "no due date" (the TC picks one
   * manually per deal instead), same as every step did before this
   * feature existed.
   */
  dueDate?: DueDateSpec | null;
  /**
   * Flags a step the template author considers non-negotiable -- a
   * brokerage's default template marking "E&O disclosure" required, say.
   * Purely a signal surfaced wherever templates themselves are shown
   * (the builder, and the picker on the new-transaction form) -- it does
   * NOT get copied onto the tasks a transaction actually generates, so
   * there's no enforcement once a deal is created from the template.
   * Omitted/absent means not required, same as every step before this
   * field existed.
   */
  required?: boolean;
}

export interface ChecklistTemplateSummary {
  id: string;
  name: string;
  steps: ChecklistTemplateStep[];
  /** True only for the one built-in, always-available baseline template. */
  isBaseline: boolean;
  /** Absent for the baseline template (it has no owner). */
  ownerUserId?: string;
}

/**
 * The fixed 6-step checklist every account gets for free, regardless of
 * plan. Always included as the first entry wherever templates are listed,
 * and always a valid choice for creating a transaction. Its steps carry
 * BASELINE_DUE_DATE_SUGGESTIONS as their `dueDate` -- reasonable starting
 * points a TC reviews and can change for every deal, not a silent default.
 */
export const BASELINE_CHECKLIST_TEMPLATE: ChecklistTemplateSummary = {
  id: BASELINE_TEMPLATE_ID,
  name: 'Baseline (default)',
  steps: TASK_TEMPLATE.map((name) => ({
    name,
    dueDate: BASELINE_DUE_DATE_SUGGESTIONS[name] ?? { ...NO_DUE_DATE },
  })),
  isBaseline: true,
};

/**
 * Normalizes a template's stored `steps` JSON into the current
 * ChecklistTemplateStep[] shape. Handles two older shapes still sitting in
 * the database so they keep reading back fine without a data migration:
 * plain strings (from before due dates existed at all), and a bare numeric
 * `dueDays` (from before per-step due-date modes existed).
 */
export function normalizeTemplateSteps(raw: unknown): ChecklistTemplateStep[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .map((item): ChecklistTemplateStep | null => {
      if (typeof item === 'string') {
        const name = item.trim().slice(0, MAX_STEP_NAME_LENGTH);
        return name.length > 0 ? { name } : null;
      }
      if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const name = (item as { name: string }).name.trim().slice(0, MAX_STEP_NAME_LENGTH);
        if (name.length === 0) return null;

        const required = (item as { required?: unknown }).required === true ? { required: true } : {};

        const rawDueDate = (item as { dueDate?: unknown }).dueDate;
        if (rawDueDate && typeof rawDueDate === 'object') {
          const spec = normalizeDueDateSpec(rawDueDate);
          return spec.mode !== 'none' ? { name, dueDate: spec, ...required } : { name, ...required };
        }

        // Legacy shape: a bare numeric `dueDays` meaning "days after acceptance".
        const rawDueDays = (item as { dueDays?: unknown }).dueDays;
        if (typeof rawDueDays === 'number' && Number.isFinite(rawDueDays)) {
          return { name, dueDate: dueDaysToSpec(rawDueDays), ...required };
        }

        return { name, ...required };
      }
      return null;
    })
    .filter((s): s is ChecklistTemplateStep => s !== null);
  return cleaned.slice(0, MAX_TEMPLATE_STEPS);
}

/**
 * Validates and normalizes a proposed step list for a custom checklist
 * template: trims each step's name, drops blanks, keeps any per-step
 * `dueDate` rule, and enforces sane length/count bounds. Returns null if
 * the input isn't usable at all.
 */
export function validateTemplateSteps(steps: unknown): ChecklistTemplateStep[] | null {
  const cleaned = normalizeTemplateSteps(steps);
  if (cleaned.length < 1 || cleaned.length > MAX_TEMPLATE_STEPS) return null;
  return cleaned;
}

export function validateTemplateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, MAX_TEMPLATE_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
