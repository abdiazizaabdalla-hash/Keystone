// Date ranges for the team report. All dates are YYYY-MM-DD in UTC, and a period includes both its first and its last day.

export type ReportCadence = 'off' | 'weekly' | 'monthly';
export interface ReportPeriod { start: string; end: string }

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => toYmd(new Date(toDate(ymd).getTime() + n * 86400000));

export const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toDate(v).getTime()) && toYmd(toDate(v)) === v;

/** The last complete Monday to Sunday week before `today`. */
export function lastFullWeek(today: string): ReportPeriod {
  const dow = (toDate(today).getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(today, -dow);
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

/** The last complete calendar month before `today`. */
export function lastFullMonth(today: string): ReportPeriod {
  const d = toDate(today);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return { start: toYmd(first), end: toYmd(last) };
}

export function lastDays(today: string, days: number): ReportPeriod {
  return { start: addDays(today, -(days - 1)), end: today };
}

export function scheduledPeriod(cadence: Exclude<ReportCadence, 'off'>, today: string): ReportPeriod {
  return cadence === 'weekly' ? lastFullWeek(today) : lastFullMonth(today);
}

/** A readable name for a period: "Week of Nov 2, 2026", "October 2026" or a plain range. */
export function periodLabel(cadence: string, p: ReportPeriod): string {
  const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) => toDate(ymd).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  if (cadence === 'monthly') return fmt(p.start, { month: 'long', year: 'numeric' });
  if (cadence === 'weekly') return `Week of ${fmt(p.start, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return `${fmt(p.start, { month: 'short', day: 'numeric', year: 'numeric' })} to ${fmt(p.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Validates a custom range from a request: real dates, start not after end, at most a year long. */
export function cleanPeriod(start: unknown, end: unknown): ReportPeriod | null {
  if (!isYmd(start) || !isYmd(end) || start > end) return null;
  if ((toDate(end).getTime() - toDate(start).getTime()) / 86400000 > 366) return null;
  return { start, end };
}
