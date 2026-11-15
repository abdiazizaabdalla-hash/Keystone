import { CLOSED_STAGE, closedOnDate, type OversightDeal } from './oversightMath';

// Trends and comparisons for a brokerage owner: closed deals and sales volume by month, and how each agent compares with the
// period before. Pure (no database). A closed deal counts on the day it closed (closedOnDate), the same rule as every other number.

const money = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/** The last `count` calendar months ending with the month of `today`, oldest first, as YYYY-MM. */
export function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

export interface MonthPoint { month: string; closedDeals: number; volume: number }

/** Closed deals and volume for each of the months, brokerage-wide or for one agent. */
export function monthlySeries(deals: OversightDeal[], months: string[], today: string, agentId?: string): MonthPoint[] {
  const points = new Map(months.map((m) => [m, { month: m, closedDeals: 0, volume: 0 }]));
  for (const d of deals) {
    if (d.status !== CLOSED_STAGE || (agentId && d.tc_user_id !== agentId)) continue;
    const p = points.get(closedOnDate(d, today).slice(0, 7));
    if (!p) continue;
    p.closedDeals += 1;
    p.volume += money(d.purchase_price);
  }
  return months.map((m) => points.get(m)!);
}

export interface AgentComparison {
  agentId: string;
  closedDeals: number;
  volume: number;
  prevClosedDeals: number;
  prevVolume: number;
  /** New deals started in the current period (by acceptance date). */
  newDeals: number;
  prevNewDeals: number;
}

/** Percentage change from previous to current, or null when there was nothing before to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Each agent's last `periodMonths` months against the `periodMonths` before them. Agents with no activity in either period are
 * still listed (all zeros) when passed in `agentIds`, so a quiet agent is visible rather than missing.
 */
export function compareAgents(deals: OversightDeal[], agentIds: string[], today: string, periodMonths: number): AgentComparison[] {
  const months = lastMonths(today, periodMonths * 2);
  const prevSet = new Set(months.slice(0, periodMonths));
  const curSet = new Set(months.slice(periodMonths));
  const rows = new Map<string, AgentComparison>(agentIds.map((id) => [id, { agentId: id, closedDeals: 0, volume: 0, prevClosedDeals: 0, prevVolume: 0, newDeals: 0, prevNewDeals: 0 }]));
  for (const d of deals) {
    const row = rows.get(d.tc_user_id);
    if (!row) continue;
    if (d.status === CLOSED_STAGE) {
      const m = closedOnDate(d, today).slice(0, 7);
      if (curSet.has(m)) { row.closedDeals += 1; row.volume += money(d.purchase_price); }
      else if (prevSet.has(m)) { row.prevClosedDeals += 1; row.prevVolume += money(d.purchase_price); }
    }
    const started = (d.acceptance_date ?? '').slice(0, 7);
    if (curSet.has(started)) row.newDeals += 1;
    else if (prevSet.has(started)) row.prevNewDeals += 1;
  }
  return [...rows.values()].sort((a, b) => b.volume - a.volume || b.closedDeals - a.closedDeals);
}

export function totalsOf(rows: AgentComparison[]): Omit<AgentComparison, 'agentId'> {
  return rows.reduce(
    (t, r) => ({ closedDeals: t.closedDeals + r.closedDeals, volume: t.volume + r.volume, prevClosedDeals: t.prevClosedDeals + r.prevClosedDeals, prevVolume: t.prevVolume + r.prevVolume, newDeals: t.newDeals + r.newDeals, prevNewDeals: t.prevNewDeals + r.prevNewDeals }),
    { closedDeals: 0, volume: 0, prevClosedDeals: 0, prevVolume: 0, newDeals: 0, prevNewDeals: 0 }
  );
}
