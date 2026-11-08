import { describe, expect, it } from 'vitest';
import { cleanPeriod, lastDays, lastFullMonth, lastFullWeek, periodLabel, scheduledPeriod } from '@/lib/teamReportPeriods';

describe('team report periods', () => {
  it('the last full week runs Monday to Sunday before today', () => {
    expect(lastFullWeek('2026-11-08')).toEqual({ start: '2026-10-26', end: '2026-11-01' }); // a Sunday
    expect(lastFullWeek('2026-11-09')).toEqual({ start: '2026-11-02', end: '2026-11-08' }); // a Monday
    expect(lastFullWeek('2026-11-11')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
  });
  it('the last full month is the calendar month before, across year ends and leap years', () => {
    expect(lastFullMonth('2026-11-08')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(lastFullMonth('2027-01-15')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(lastFullMonth('2028-03-01')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
  it('last N days includes today', () => {
    expect(lastDays('2026-11-08', 7)).toEqual({ start: '2026-11-02', end: '2026-11-08' });
  });
  it('scheduled periods follow the cadence, and labels read well', () => {
    expect(scheduledPeriod('weekly', '2026-11-09')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(periodLabel('monthly', { start: '2026-10-01', end: '2026-10-31' })).toBe('October 2026');
    expect(periodLabel('weekly', { start: '2026-11-02', end: '2026-11-08' })).toBe('Week of Nov 2, 2026');
    expect(periodLabel('manual', { start: '2026-11-02', end: '2026-11-08' })).toBe('Nov 2, 2026 to Nov 8, 2026');
  });
  it('a custom range must be real, in order and at most a year', () => {
    expect(cleanPeriod('2026-11-01', '2026-11-08')).toEqual({ start: '2026-11-01', end: '2026-11-08' });
    expect(cleanPeriod('2026-11-09', '2026-11-08')).toBeNull();
    expect(cleanPeriod('2026-02-30', '2026-03-01')).toBeNull();
    expect(cleanPeriod('2025-01-01', '2026-11-08')).toBeNull();
    expect(cleanPeriod(5, null)).toBeNull();
  });
});
