import { describe, expect, it } from 'vitest';
import { normaliseEmail, dealHealth, productionFor, nextStepFor, listingHealth, isOpenListing, closingSoon, closedWithoutCommission, type OversightDeal } from '@/lib/oversightMath';
import { isFeatureOn } from '@/lib/features';

const today = '2026-11-03';
const deal = (over: Partial<OversightDeal>): OversightDeal => ({ id: 'd', tc_user_id: 'u', property_address: null, file_number: null, status: 'Contract Pending', purchase_price: null, acceptance_date: null, closing_date: null, updated_at: null, ...over });

describe('dealHealth', () => {
  it('counts open and overdue steps and finds the next due date', () => {
    const h = dealHealth({ status: 'Contract Pending', acceptance_date: '2026-10-20', closing_date: '2026-12-15' }, [
      { completed: true, due_date: '2026-10-01' },
      { completed: false, due_date: '2026-10-30' },
      { completed: false, due_date: '2026-11-10' },
      { completed: false, due_date: '2026-11-05' },
      { completed: false, due_date: null },
    ], today);
    expect(h).toMatchObject({ openTasks: 4, overdueTasks: 1, nextDue: '2026-11-05', flags: ['overdue'] });
  });
  it('flags a close within two weeks with open steps, and a missing closing date', () => {
    expect(dealHealth({ status: 'Clear to Close', acceptance_date: '2026-10-01', closing_date: '2026-11-10' }, [{ completed: false, due_date: null }], today).flags).toEqual(['closing_soon']);
    expect(dealHealth({ status: 'Clear to Close', acceptance_date: '2026-10-01', closing_date: '2026-11-10' }, [{ completed: true, due_date: null }], today).flags).toEqual([]);
    expect(dealHealth({ status: 'Contract Pending', acceptance_date: '2026-10-01', closing_date: null }, [], today).flags).toEqual(['no_closing_date']);
  });
  it('a closed deal never needs attention', () => {
    expect(dealHealth({ status: 'Closed', acceptance_date: null, closing_date: null }, [{ completed: false, due_date: '2020-01-01' }], today)).toEqual({ openTasks: 0, overdueTasks: 0, nextDue: null, flags: [] });
  });
});

describe('productionFor', () => {
  it('counts closings this year and last 30 days, and the open pipeline', () => {
    const p = productionFor([
      deal({ status: 'Closed', closing_date: '2026-10-20', purchase_price: '400000.00' }),
      deal({ status: 'Closed', closing_date: '2026-02-01', purchase_price: 300000 }),
      deal({ status: 'Closed', closing_date: '2025-12-01', purchase_price: 999999 }),
      deal({ status: 'Closed', closing_date: null, updated_at: '2026-11-01T10:00:00Z', purchase_price: 100000 }),
      deal({ status: 'Contract Pending', purchase_price: 250000 }),
      deal({ status: 'Clear to Close', purchase_price: null }),
    ], today);
    expect(p).toEqual({ closedThisYear: 3, volumeThisYear: 800000, closedLast30Days: 2, activeDeals: 2, pipelineVolume: 250000 });
  });
});

describe('email check and the feature flag', () => {
  it('normalises good addresses and rejects bad ones', () => {
    expect(normaliseEmail('  Agent@Example.COM ')).toBe('agent@example.com');
    expect(normaliseEmail('nope')).toBeNull();
    expect(normaliseEmail(42)).toBeNull();
  });
  it('brokerage is off unless listed', () => {
    expect(isFeatureOn('brokerage', '')).toBe(false);
    expect(isFeatureOn('brokerage', 'agent_workspace,templates')).toBe(false);
    expect(isFeatureOn('brokerage', 'templates,brokerage')).toBe(true);
  });
});

describe('nextStepFor', () => {
  const t = (name: string, completed: boolean, due_date: string | null, sort_order: number) => ({ name, completed, due_date, sort_order });
  it('picks the open step with the earliest due date', () => {
    expect(nextStepFor([t('Inspection', false, '2026-11-10', 2), t('Earnest money', false, '2026-11-05', 1), t('Contract', true, '2026-10-01', 0)])).toEqual({ name: 'Earnest money', dueDate: '2026-11-05' });
  });
  it('falls back to checklist order when nothing is dated, and dated steps beat undated ones', () => {
    expect(nextStepFor([t('B', false, null, 5), t('A', false, null, 1)])).toEqual({ name: 'A', dueDate: null });
    expect(nextStepFor([t('Undated', false, null, 0), t('Dated', false, '2027-01-01', 9)])).toEqual({ name: 'Dated', dueDate: '2027-01-01' });
  });
  it('is null when everything is done', () => {
    expect(nextStepFor([t('A', true, null, 1)])).toBeNull();
    expect(nextStepFor([])).toBeNull();
  });
});

describe('listingHealth', () => {
  const t = (completed: boolean, due_date: string | null) => ({ completed, due_date });
  it('flags overdue steps and an agreement ending within 14 days', () => {
    const h = listingHealth({ status: 'active', expiration_date: '2026-11-10' }, [t(false, '2026-10-30'), t(false, '2026-11-20'), t(true, '2026-10-01')], today);
    expect(h).toEqual({ openTasks: 2, overdueTasks: 1, nextDue: '2026-10-30', flags: ['overdue', 'expiring_soon'] });
  });
  it('has no flags once a listing is under contract, expired or withdrawn', () => {
    for (const status of ['converted', 'expired', 'withdrawn']) expect(listingHealth({ status, expiration_date: '2020-01-01' }, [t(false, '2020-01-01')], today).flags).toEqual([]);
  });
  it('knows which statuses are open', () => {
    expect(['preparing', 'active', 'under_offer'].every(isOpenListing)).toBe(true);
    expect(['converted', 'expired', 'withdrawn', null].some((x) => isOpenListing(x))).toBe(false);
  });
});

describe('owner home helpers', () => {
  it('closingSoon lists open deals closing in the next 30 days, soonest first', () => {
    const d = (id: string, status: string, closing_date: string | null) => ({ id, status, closing_date });
    const out = closingSoon([d('a', 'Contract Pending', '2026-11-20'), d('b', 'Contract Pending', '2026-11-05'), d('c', 'Closed', '2026-11-04'), d('d', 'Contract Pending', '2027-02-01'), d('e', 'Contract Pending', '2026-10-01'), d('f', 'Contract Pending', null)], today, 30);
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('closedWithoutCommission finds recent closings that have no statement', () => {
    const d = (id: string, status: string, closing_date: string | null) => ({ id, status, closing_date, updated_at: null });
    const out = closedWithoutCommission([d('a', 'Closed', '2026-10-20'), d('b', 'Closed', '2026-10-21'), d('c', 'Closed', '2025-01-01'), d('d', 'Contract Pending', null)], new Set(['b']), today);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });
});

describe('rosterStats (the broker\'s live roster line)', () => {
  const today = '2026-03-10';
  const health = (n: number) => ({ overdueTasks: n });
  it('counts open deals, late steps, closings in the next 7 days and the latest activity', async () => {
    const { rosterStats } = await import('../src/lib/oversightMath');
    const deals = [
      { status: 'Under Contract', closing_date: '2026-03-12', updated_at: '2026-03-08T10:00:00Z', health: health(2) },
      { status: 'Under Contract', closing_date: '2026-03-17', updated_at: '2026-03-01T10:00:00Z', health: health(0) },
      { status: 'Under Contract', closing_date: '2026-03-18', updated_at: '2026-03-02T10:00:00Z', health: health(1) },
      { status: 'Closed', closing_date: '2026-03-11', updated_at: '2026-03-03T10:00:00Z', health: health(0) },
    ];
    const r = rosterStats(deals, [{ updated_at: '2026-03-09T09:00:00Z' }], today);
    expect(r).toEqual({ openDeals: 3, lateTasks: 3, lateDeals: 2, closingThisWeek: 2, lastActivity: '2026-03-09T09:00:00Z' });
  });
  it('is all zero for an agent with nothing yet', async () => {
    const { rosterStats } = await import('../src/lib/oversightMath');
    expect(rosterStats([], [], today)).toEqual({ openDeals: 0, lateTasks: 0, lateDeals: 0, closingThisWeek: 0, lastActivity: null });
  });
});

describe('weekly broker digest', () => {
  it('is empty with no agents, and lists the late ones first', async () => {
    const { digestParagraphs, digestSubject } = await import('../src/lib/brokerageDigestRules');
    expect(digestParagraphs([])).toBeNull();
    const agents = [
      { name: 'Ana', openDeals: 2, lateTasks: 0, closingThisWeek: 1, closingAddresses: ['1 Oak St'] },
      { name: 'Ben', openDeals: 1, lateTasks: 3, closingThisWeek: 0, closingAddresses: [] },
    ];
    const text = digestParagraphs(agents)!;
    expect(text[0]).toContain('3 steps are late');
    expect(text[1].split('\n')[0]).toBe('Ben: 1 open deal, 3 late');
    expect(text[1].split('\n')[1]).toBe('Ana: 2 open deals, nothing late, 1 closing this week');
    expect(text[2]).toContain('1 Oak St (Ana)');
    expect(digestSubject(agents)).toContain('3 late steps');
    expect(digestSubject([{ ...agents[0] }])).toBe('Your week across your agents');
  });
});
