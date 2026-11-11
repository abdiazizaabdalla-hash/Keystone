// Day arithmetic for due dates. Days are plain YYYY-MM-DD strings (no time zone surprises).
// Business days skip Saturdays and Sundays only. Holidays differ by state and brokerage, so they are not guessed here:
// a due date that lands on a holiday is something the TC adjusts, and nothing silently moves an important deadline.

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addCalendarDays(day: string, n: number): string {
  return fmt(parse(day) + n * DAY);
}

export function isWeekend(day: string): boolean {
  const dow = new Date(parse(day)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Moves forward (or back, for a negative n) by whole business days. Zero business days from a weekend lands on the next Monday. */
export function addBusinessDays(day: string, n: number): string {
  let ms = parse(day);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    ms += step * DAY;
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  if (n === 0 && isWeekend(day)) {
    while (new Date(ms).getUTCDay() === 0 || new Date(ms).getUTCDay() === 6) ms += DAY;
  }
  return fmt(ms);
}

export function addDays(day: string, n: number, business: boolean): string {
  return business ? addBusinessDays(day, n) : addCalendarDays(day, n);
}
