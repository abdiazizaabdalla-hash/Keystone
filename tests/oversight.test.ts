import { describe, expect, it } from 'vitest';
import { normaliseEmail, dealHealth, productionFor, type OversightDeal } from '@/lib/oversightMath';
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
