// A brokerage's cap for an agent: once the agent has paid the brokerage a set amount in a period, they keep (nearly) all of
// each commission until the period resets. Pure (no database). Step 1 only shows the cap and warns when it is close or reached;
// the amounts counted are the brokerage's share on confirmed statements that Relay holds, so deals from before the agent used
// Relay are not in the total. The same function will drive full year-to-date tracking later.

export type CapReset = 'calendar_year' | 'anniversary';
export const CAP_RESETS: CapReset[] = ['calendar_year', 'anniversary'];
export const isCapReset = (v: unknown): v is CapReset => typeof v === 'string' && (CAP_RESETS as string[]).includes(v);

export interface CapTerms {
  capCents: number;
  reset: CapReset;
  /** The agent's anniversary with the brokerage (any date in the year they joined); only used when `reset` is 'anniversary'. */
  anchor: string | null;
}

export interface CapContribution {
  /** When the deal counts: its closing date, or when the statement was confirmed. */
  onDate: string;
  /** What the agent paid the brokerage on this deal (the brokerage's share of the commission), in cents. */
  cents: number;
}

export type CapState = 'ok' | 'near' | 'reached' | 'unknown';

export interface CapProgress {
  state: CapState;
  periodStart: string | null;
  /** The first day of the next period (the day the cap resets). */
  resetsOn: string | null;
  usedCents: number;
  remainingCents: number;
  /** 0 to 100 (capped). */
  percent: number;
}

export const CAP_NEAR_PERCENT = 80;

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The period containing `today`, as [start, nextStart). Null when an anniversary cap has no anniversary date to count from. */
export function capPeriod(terms: Pick<CapTerms, 'reset' | 'anchor'>, today: string): { start: string; next: string } | null {
  const y = Number(today.slice(0, 4));
  if (terms.reset === 'calendar_year') return { start: iso(y, 1, 1), next: iso(y + 1, 1, 1) };
  if (!terms.anchor || !/^\d{4}-\d{2}-\d{2}/.test(terms.anchor)) return null;
  const m = Number(terms.anchor.slice(5, 7));
  const d = Number(terms.anchor.slice(8, 10));
  const on = (year: number) => iso(year, m, Math.min(d, daysIn(year, m)));
  const thisYear = on(y);
  return today >= thisYear ? { start: thisYear, next: on(y + 1) } : { start: on(y - 1), next: thisYear };
}

export function capProgress(terms: CapTerms, contributions: CapContribution[], today: string): CapProgress {
  const period = capPeriod(terms, today);
  if (!period) return { state: 'unknown', periodStart: null, resetsOn: null, usedCents: 0, remainingCents: terms.capCents, percent: 0 };
  const used = contributions.filter((c) => c.onDate.slice(0, 10) >= period.start && c.onDate.slice(0, 10) < period.next).reduce((n, c) => n + Math.max(0, c.cents), 0);
  const percent = Math.min(100, Math.round((used / terms.capCents) * 100));
  return {
    state: used >= terms.capCents ? 'reached' : percent >= CAP_NEAR_PERCENT ? 'near' : 'ok',
    periodStart: period.start,
    resetsOn: period.next,
    usedCents: used,
    remainingCents: Math.max(0, terms.capCents - used),
    percent,
  };
}
