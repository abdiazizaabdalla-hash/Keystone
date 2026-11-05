import { TRANSACTION_STAGES } from './transactionStages';

// The numbers a brokerage owner sees. Pure (no database), so they can be unit tested.

export const CLOSED_STAGE = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1];

/** A trimmed, lower-case email, or null when it is not a plausible address. */
export function normaliseEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email) && email.length <= 254 ? email : null;
}

// ---- Numbers the owner sees (pure, so they can be tested without a database) ----

export interface OversightDeal {
  id: string;
  tc_user_id: string;
  property_address: string | null;
  file_number: string | null;
  status: string | null;
  purchase_price: number | string | null;
  acceptance_date: string | null;
  closing_date: string | null;
  updated_at: string | null;
}
export interface OversightTask {
  transaction_id: string;
  name?: string;
  sort_order?: number | null;
  completed: boolean | null;
  due_date: string | null;
}

export type AttentionFlag = 'overdue' | 'closing_soon' | 'no_closing_date';

export interface DealHealth {
  openTasks: number;
  overdueTasks: number;
  nextDue: string | null;
  flags: AttentionFlag[];
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Open and overdue steps, the next due date, and what needs attention, for one deal. `today` is YYYY-MM-DD. */
export function dealHealth(deal: Pick<OversightDeal, 'status' | 'acceptance_date' | 'closing_date'>, tasks: Pick<OversightTask, 'completed' | 'due_date'>[], today: string): DealHealth {
  if (deal.status === CLOSED_STAGE) return { openTasks: 0, overdueTasks: 0, nextDue: null, flags: [] };
  const open = tasks.filter((t) => !t.completed);
  const dated = open.filter((t) => t.due_date).map((t) => String(t.due_date).slice(0, 10)).sort();
  const overdue = dated.filter((d) => d < today).length;
  const nextDue = dated.find((d) => d >= today) ?? null;
  const flags: AttentionFlag[] = [];
  if (overdue > 0) flags.push('overdue');
  if (deal.closing_date && deal.closing_date >= today && deal.closing_date <= addDays(today, 14) && open.length > 0) flags.push('closing_soon');
  if (deal.acceptance_date && !deal.closing_date) flags.push('no_closing_date');
  return { openTasks: open.length, overdueTasks: overdue, nextDue, flags };
}

export interface Production {
  closedThisYear: number;
  volumeThisYear: number;
  closedLast30Days: number;
  activeDeals: number;
  pipelineVolume: number;
}

const money = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/** Production for a set of deals. A closed deal counts on its closing date (or the day it was last updated if none). */
export function productionFor(deals: OversightDeal[], today: string): Production {
  const year = today.slice(0, 4);
  const since = addDays(today, -30);
  const out: Production = { closedThisYear: 0, volumeThisYear: 0, closedLast30Days: 0, activeDeals: 0, pipelineVolume: 0 };
  for (const d of deals) {
    if (d.status === CLOSED_STAGE) {
      const closedOn = (d.closing_date || d.updated_at || '').slice(0, 10);
      if (closedOn.startsWith(year)) {
        out.closedThisYear += 1;
        out.volumeThisYear += money(d.purchase_price);
      }
      if (closedOn >= since && closedOn <= today) out.closedLast30Days += 1;
    } else {
      out.activeDeals += 1;
      out.pipelineVolume += money(d.purchase_price);
    }
  }
  return out;
}


export interface NextStep {
  name: string;
  dueDate: string | null;
}

/** The step to do next on a deal: the earliest-dated open step (an overdue one counts), else the first open step in checklist order. */
export function nextStepFor(tasks: Pick<OversightTask, 'name' | 'completed' | 'due_date' | 'sort_order'>[]): NextStep | null {
  const open = tasks.filter((t) => !t.completed && t.name);
  if (open.length === 0) return null;
  const key = (t: (typeof open)[number]) => `${t.due_date ? String(t.due_date).slice(0, 10) : '9999-99-99'}|${String(t.sort_order ?? 0).padStart(6, '0')}`;
  const first = [...open].sort((a, b) => key(a).localeCompare(key(b)))[0];
  return { name: first.name as string, dueDate: first.due_date ? String(first.due_date).slice(0, 10) : null };
}

// ---- Listings (the same oversight, for an agent's listings) ----

/** A listing that is still being worked: not under contract, expired or withdrawn. */
export const OPEN_LISTING_STATUSES = ['preparing', 'active', 'under_offer'] as const;
export const isOpenListing = (status: string | null | undefined) => (OPEN_LISTING_STATUSES as readonly string[]).includes(String(status));

export interface OversightListing {
  id: string;
  tc_user_id: string;
  property_address: string | null;
  status: string | null;
  list_price: number | string | null;
  planned_list_date: string | null;
  listed_on: string | null;
  expiration_date: string | null;
  mls_number: string | null;
  updated_at: string | null;
}

export interface ListingHealth {
  openTasks: number;
  overdueTasks: number;
  nextDue: string | null;
  /** overdue | expiring_soon (open listing whose agreement ends within 14 days, or already ended) */
  flags: string[];
}

export function listingHealth(listing: Pick<OversightListing, 'status' | 'expiration_date'>, tasks: Pick<OversightTask, 'completed' | 'due_date'>[], today: string): ListingHealth {
  if (!isOpenListing(listing.status)) return { openTasks: 0, overdueTasks: 0, nextDue: null, flags: [] };
  const open = tasks.filter((t) => !t.completed);
  const dates = open.map((t) => (t.due_date ? String(t.due_date).slice(0, 10) : null)).filter(Boolean) as string[];
  const overdue = dates.filter((d) => d < today).length;
  const nextDue = [...dates].sort()[0] ?? null;
  const flags: string[] = [];
  if (overdue > 0) flags.push('overdue');
  const exp = listing.expiration_date ? String(listing.expiration_date).slice(0, 10) : null;
  if (exp && exp <= addDays(today, 14)) flags.push('expiring_soon');
  return { openTasks: open.length, overdueTasks: overdue, nextDue, flags };
}

// ---- Brokerage owner home ----

/** Open deals closing within `days` days (today included), soonest first. */
export function closingSoon<T extends { status: string | null; closing_date: string | null }>(deals: T[], today: string, days = 30): T[] {
  const end = addDays(today, days);
  return deals
    .filter((d) => d.status !== CLOSED_STAGE && d.closing_date && d.closing_date.slice(0, 10) >= today && d.closing_date.slice(0, 10) <= end)
    .sort((a, b) => String(a.closing_date).localeCompare(String(b.closing_date)));
}

/** Closed deals (closed within `days` days) that have no commission statement yet. */
export function closedWithoutCommission<T extends { id: string; status: string | null; closing_date: string | null; updated_at: string | null }>(deals: T[], withCommission: Set<string>, today: string, days = 120): T[] {
  const since = addDays(today, -days);
  return deals.filter((d) => d.status === CLOSED_STAGE && !withCommission.has(d.id) && (d.closing_date || d.updated_at || '').slice(0, 10) >= since);
}


// ---- Live roster: one line per agent ----

export interface RosterStats {
  openDeals: number;
  /** Open checklist steps past their due date, across the agent's open deals. */
  lateTasks: number;
  /** Open deals with at least one late step. */
  lateDeals: number;
  /** Open deals closing today through the next 7 days. */
  closingThisWeek: number;
  /** Most recent change on any of their deals or listings (ISO timestamp), or null. */
  lastActivity: string | null;
}

/** What the broker's roster shows for one agent. `today` is YYYY-MM-DD. */
export function rosterStats(
  deals: (Pick<OversightDeal, 'status' | 'closing_date' | 'updated_at'> & { health: Pick<DealHealth, 'overdueTasks'> })[],
  listings: { updated_at: string | null }[],
  today: string
): RosterStats {
  const open = deals.filter((d) => d.status !== CLOSED_STAGE);
  const end = addDays(today, 7);
  const stamps = [...deals.map((d) => d.updated_at), ...listings.map((l) => l.updated_at)].filter((x): x is string => !!x).sort();
  return {
    openDeals: open.length,
    lateTasks: open.reduce((n, d) => n + d.health.overdueTasks, 0),
    lateDeals: open.filter((d) => d.health.overdueTasks > 0).length,
    closingThisWeek: open.filter((d) => d.closing_date && d.closing_date.slice(0, 10) >= today && d.closing_date.slice(0, 10) <= end).length,
    lastActivity: stamps.length ? stamps[stamps.length - 1] : null,
  };
}
