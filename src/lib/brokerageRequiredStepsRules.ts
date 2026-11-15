// Brokerage required steps: the checklist a broker sets once for every agent's transactions and listings. Pure (no database).

export const REQUIRED_STEP_KINDS = ['transaction', 'listing'] as const;
export type StepKind = (typeof REQUIRED_STEP_KINDS)[number];
export const isStepKind = (v: unknown): v is StepKind => (REQUIRED_STEP_KINDS as readonly string[]).includes(String(v));
export const MAX_REQUIRED_STEPS = 20;
export const STEP_NAME_MAX = 60;

export interface RequiredStep { name: string; dueDays: number | null }

/** The steps a person sent: trimmed names, no blanks or repeats (ignoring case), days kept to 0-365, at most 20. */
export function cleanRequiredSteps(input: unknown): RequiredStep[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: RequiredStep[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ').slice(0, STEP_NAME_MAX) : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const n = r.dueDays === null || r.dueDays === '' || r.dueDays === undefined ? NaN : Number(r.dueDays);
    out.push({ name, dueDays: Number.isFinite(n) ? Math.min(365, Math.max(0, Math.round(n))) : null });
    if (out.length >= MAX_REQUIRED_STEPS) break;
  }
  return out;
}

/** The required steps a file does not have yet (same name, ignoring case, counts as having it). */
export function stepsToAdd(existingNames: string[], required: RequiredStep[]): RequiredStep[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return required.filter((s) => !have.has(s.name.toLowerCase()));
}
