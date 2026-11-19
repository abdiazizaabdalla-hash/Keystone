import { describe, expect, it } from 'vitest';
import { CAP_NEAR_PERCENT, capPeriod, capProgress } from '@/lib/commissionCap';

const cal = { capCents: 1_500_000, reset: 'calendar_year' as const, anchor: null };
const ann = { capCents: 1_500_000, reset: 'anniversary' as const, anchor: '2024-06-15' };

describe('capPeriod', () => {
  it('uses the calendar year', () => {
    expect(capPeriod(cal, '2026-10-24')).toEqual({ start: '2026-01-01', next: '2027-01-01' });
  });
  it('uses the agent’s anniversary, before and after it in the year', () => {
    expect(capPeriod(ann, '2026-10-24')).toEqual({ start: '2026-06-15', next: '2027-06-15' });
    expect(capPeriod(ann, '2026-03-01')).toEqual({ start: '2025-06-15', next: '2026-06-15' });
    expect(capPeriod(ann, '2026-06-15')).toEqual({ start: '2026-06-15', next: '2027-06-15' });
  });
  it('has no period for an anniversary cap without a date', () => {
    expect(capPeriod({ reset: 'anniversary', anchor: null }, '2026-10-24')).toBeNull();
  });
  it('moves a Feb 29 anniversary to Feb 28 in other years', () => {
    expect(capPeriod({ reset: 'anniversary', anchor: '2024-02-29' }, '2026-10-24')).toEqual({ start: '2026-02-28', next: '2027-02-28' });
  });
});

describe('capProgress', () => {
  const at = (onDate: string, cents: number) => ({ onDate, cents });
  it('counts only the current period', () => {
    const p = capProgress(cal, [at('2025-12-31', 900_000), at('2026-02-01', 300_000), at('2026-09-01', 200_000)], '2026-10-24');
    expect(p.usedCents).toBe(500_000);
    expect(p.remainingCents).toBe(1_000_000);
    expect(p.state).toBe('ok');
    expect(p.resetsOn).toBe('2027-01-01');
  });
  it('warns near the cap and at it', () => {
    const near = capProgress(cal, [at('2026-02-01', 1_500_000 * (CAP_NEAR_PERCENT / 100))], '2026-10-24');
    expect(near.state).toBe('near');
    expect(near.percent).toBe(CAP_NEAR_PERCENT);
    const reached = capProgress(cal, [at('2026-02-01', 1_500_000), at('2026-03-01', 10_000)], '2026-10-24');
    expect(reached.state).toBe('reached');
    expect(reached.remainingCents).toBe(0);
    expect(reached.percent).toBe(100);
  });
  it('is unknown when an anniversary cap has no date, and ignores negative amounts', () => {
    expect(capProgress({ capCents: 1_000, reset: 'anniversary', anchor: null }, [at('2026-01-01', 500)], '2026-10-24').state).toBe('unknown');
    expect(capProgress(cal, [at('2026-02-01', -400_000)], '2026-10-24').usedCents).toBe(0);
  });
});
