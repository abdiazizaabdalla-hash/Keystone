import { describe, expect, it } from 'vitest';
import { addDays, addYears, dueDatesFor } from '@/lib/templateRuleDates';

const closed = { status: 'Closed', closingDate: '2026-06-01', acceptanceDate: '2026-05-01' };
const open = { status: 'Contract Pending', closingDate: '2026-06-01', acceptanceDate: '2026-05-01' };
const base = { repeat_yearly: false, repeat_years: 5 };

describe('template rule dates', () => {
  it('does arithmetic on whole days and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('"when the deal closes" fires the day it is noticed, only once the deal is closed', () => {
    const r = { ...base, trigger_event: 'deal_closed' as const, offset_days: 0 };
    expect(dueDatesFor(r, open, '2026-06-02')).toEqual([]);
    expect(dueDatesFor(r, closed, '2026-06-02')).toEqual(['2026-06-02']);
    // later checks reuse the first day, so it does not move
    expect(dueDatesFor(r, closed, '2026-06-03', '2026-06-02')).toEqual(['2026-06-02']);
    expect(dueDatesFor(r, closed, '2026-06-20', '2026-06-02')).toEqual([]);
  });

  it('days after closing needs a closed deal and comes due on the day', () => {
    const r = { ...base, trigger_event: 'closing_date' as const, offset_days: 7 };
    expect(dueDatesFor(r, closed, '2026-06-07')).toEqual([]);
    expect(dueDatesFor(r, closed, '2026-06-08')).toEqual(['2026-06-08']);
    expect(dueDatesFor(r, closed, '2026-06-14')).toEqual(['2026-06-08']);
    expect(dueDatesFor(r, closed, '2026-06-16')).toEqual([]); // older than the catch-up week: not back-filled
    expect(dueDatesFor(r, open, '2026-06-08')).toEqual([]);
  });

  it('days before closing only applies while the deal is open', () => {
    const r = { ...base, trigger_event: 'closing_date' as const, offset_days: -3 };
    expect(dueDatesFor(r, open, '2026-05-29')).toEqual(['2026-05-29']);
    expect(dueDatesFor(r, closed, '2026-05-29')).toEqual([]);
    expect(dueDatesFor(r, { ...open, closingDate: null }, '2026-05-29')).toEqual([]);
  });

  it('repeats every year on the anniversary', () => {
    const r = { trigger_event: 'closing_date' as const, offset_days: 365, repeat_yearly: true, repeat_years: 3 };
    // 365 days after 2026-06-01 is 2027-06-01; the next ones are a year apart
    expect(dueDatesFor(r, closed, '2027-06-01')).toEqual(['2027-06-01']);
    expect(dueDatesFor(r, closed, '2028-06-02')).toEqual(['2028-06-01']);
    expect(dueDatesFor(r, closed, '2027-12-01')).toEqual([]);
  });

  it('acceptance-date rules apply only while the deal is open', () => {
    const r = { ...base, trigger_event: 'acceptance_date' as const, offset_days: 0 };
    expect(dueDatesFor(r, open, '2026-05-01')).toEqual(['2026-05-01']);
    expect(dueDatesFor(r, closed, '2026-05-01')).toEqual([]);
  });
});
