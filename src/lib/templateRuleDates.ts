// The date arithmetic behind automatic template rules. No database in here, so it can be tested on its own.

export type RuleTrigger = 'deal_closed' | 'closing_date' | 'acceptance_date';

export interface RuleShape {
  trigger_event: RuleTrigger;
  offset_days: number;
  repeat_yearly: boolean;
  repeat_years: number;
}

export interface DealDates {
  status: string;
  closingDate: string | null;
  acceptanceDate: string | null;
}

/** A draft is only made for a date that came due in the last week, so switching a rule on never floods old deals. */
export const CATCH_UP_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, n: number): string {
  return isoDay(new Date(parse(iso).getTime() + n * DAY));
}

export function addYears(iso: string, n: number): string {
  const d = parse(iso);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + n);
  if (d.getUTCMonth() !== month) d.setUTCDate(0); // Feb 29 -> Feb 28 in a non-leap year
  return isoDay(d);
}

/**
 * The dates on which this rule should have produced a draft by `today` and has not yet aged out of the catch-up week.
 * `knownAnchor` is, for "when the deal closes", the day the first draft was made (the day Relay noticed the close).
 */
export function dueDatesFor(rule: RuleShape, deal: DealDates, today: string, knownAnchor?: string | null): string[] {
  const closed = deal.status === 'Closed';
  let anchor: string | null = null;
  if (rule.trigger_event === 'deal_closed') {
    if (!closed) return [];
    anchor = knownAnchor ?? today;
  } else if (rule.trigger_event === 'closing_date') {
    anchor = deal.closingDate;
    // after the closing date means after closing, before it means a deal still open
    if (rule.offset_days >= 0 ? !closed : closed) return [];
  } else {
    anchor = deal.acceptanceDate;
    if (closed) return [];
  }
  if (!anchor) return [];
  const years = rule.repeat_yearly ? rule.repeat_years : 0;
  const earliest = addDays(today, -CATCH_UP_DAYS);
  const out: string[] = [];
  for (let k = 0; k <= years; k++) {
    const due = addYears(addDays(anchor, rule.offset_days), k);
    if (due <= today && due >= earliest) out.push(due);
  }
  return out;
}

