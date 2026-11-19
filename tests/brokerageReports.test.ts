import { describe, expect, it } from 'vitest';
import { CLOSED_STAGE } from '@/lib/oversightMath';
import { compareAgents, lastMonths, monthlySeries, percentChange } from '@/lib/oversightTrends';
import { buildReport, cleanColumns, cleanFilters, filterDeals, DEFAULT_REPORT_COLUMNS, type ReportDeal } from '@/lib/dealReport';

const base = { file_number: null, acceptance_date: null, updated_at: null, checklist_template_name: null, health: { openTasks: 0, overdueTasks: 0, nextDue: null, flags: [] }, tasksTotal: 4, tasksDone: 3 };
const deal = (o: Partial<ReportDeal>): ReportDeal => ({ id: 'd', tc_user_id: 'a1', property_address: '1 Main St', status: CLOSED_STAGE, purchase_price: 300000, closing_date: '2026-10-10', ...base, ...o } as ReportDeal);

describe('trends', () => {
  it('lists months ending with this one, across a year boundary', () => {
    expect(lastMonths('2026-02-14', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('counts closed deals and volume in the month they closed', () => {
    const s = monthlySeries([deal({}), deal({ id: 'e', closing_date: '2026-10-20', purchase_price: 100000 }), deal({ id: 'f', status: 'Active' })], ['2026-09', '2026-10'], '2026-11-15');
    expect(s[1]).toEqual({ month: '2026-10', closedDeals: 2, volume: 400000 });
    expect(s[0].closedDeals).toBe(0);
  });
  it('compares the last period with the one before, and keeps quiet agents', () => {
    const rows = compareAgents([deal({}), deal({ id: 'p', closing_date: '2026-06-10' })], ['a1', 'a2'], '2026-11-15', 3);
    expect(rows.find((r) => r.agentId === 'a1')).toMatchObject({ closedDeals: 1, prevClosedDeals: 1, volume: 300000 });
    expect(rows.find((r) => r.agentId === 'a2')?.closedDeals).toBe(0);
  });
  it('gives no percentage when there was nothing before', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(150, 100)).toBe(50);
  });
});

describe('deal report', () => {
  const deals = [deal({}), deal({ id: 'x', tc_user_id: 'a2', status: 'Active', closing_date: '2026-12-01' }), deal({ id: 'y', closing_date: null })];
  it('filters by agent, scope and closing dates', () => {
    expect(filterDeals(deals, cleanFilters({ scope: 'closed' })).map((d) => d.id)).toEqual(['d', 'y']);
    expect(filterDeals(deals, cleanFilters({ agents: 'a2' })).map((d) => d.id)).toEqual(['x']);
    expect(filterDeals(deals, cleanFilters({ from: '2026-10-01', to: '2026-10-31' })).map((d) => d.id)).toEqual(['d']);
  });
  it('falls back to the default columns and builds rows in the chosen order', () => {
    expect(cleanColumns('nonsense')).toEqual(DEFAULT_REPORT_COLUMNS);
    const { head, rows } = buildReport([deals[0]], cleanColumns('price,address'), () => ({ agentName: 'Ann', agentEmail: '', missing: null }));
    expect(head.map((h) => h.id)).toEqual(['address', 'price']);
    expect(rows[0]).toEqual(['1 Main St', 300000]);
  });
});

import { adminLimit, allowedRoles, roleAllows, scopesFor, isAdminRole, looksLikeEmail } from '@/lib/brokerageAdmins';

describe('brokerage administrators', () => {
  it('gives Basic one full administrator and Pro five scoped ones', () => {
    expect(adminLimit('basic')).toBe(1);
    expect(adminLimit('pro')).toBe(5);
    expect(allowedRoles('basic')).toEqual(['manager', 'managing']);
    expect(allowedRoles('pro')).toEqual(['viewer', 'reviewer', 'manager', 'managing']);
  });
  it('limits what each role can do', () => {
    expect(scopesFor('viewer')).toEqual(['view']);
    expect(roleAllows('viewer', 'compliance')).toBe(false);
    expect(roleAllows('reviewer', 'compliance')).toBe(true);
    expect(roleAllows('reviewer', 'roster')).toBe(false);
    expect(roleAllows('manager', 'roster')).toBe(true);
  });
  it('validates roles and emails', () => {
    expect(isAdminRole('manager')).toBe(true);
    expect(isAdminRole('owner')).toBe(false);
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail('nope')).toBe(false);
  });
});

import { periodKpis, pipelineNow } from '@/lib/oversightTrends';

describe('period headline numbers and pipeline', () => {
  const closedDeal = deal({ acceptance_date: '2026-09-20', closing_date: '2026-10-10' });
  it('averages price and days to close for the period', () => {
    const { current, previous } = periodKpis([closedDeal, deal({ id: 'z', acceptance_date: '2026-09-30', closing_date: '2026-10-20', purchase_price: 500000 })], '2026-11-15', 3);
    expect(current.closedDeals).toBe(2);
    expect(current.avgPrice).toBe(400000);
    expect(current.avgDaysToClose).toBe(20);
    expect(previous.closedDeals).toBe(0);
    expect(previous.avgPrice).toBeNull();
  });
  it('counts what is open and closing in the next 30 days', () => {
    const open = deal({ id: 'o', status: 'Active', closing_date: '2026-12-01' });
    const late = deal({ id: 'l', status: 'Active', closing_date: '2027-03-01', health: { openTasks: 2, overdueTasks: 1, nextDue: null, flags: [] } });
    const p = pipelineNow([closedDeal, open, late], '2026-11-15');
    expect(p).toMatchObject({ openDeals: 2, closingNext30: 1, withOverdueSteps: 1, openVolume: 600000 });
  });
});
