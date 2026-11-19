import { describe, it, expect } from 'vitest';
import { compStatus, defaultCompEnd } from '@/lib/compPeriod';

const NOW = Date.parse('2026-11-10T12:00:00Z');

describe('compStatus (a paid plan that is free until a date)', () => {
  it('does not apply when there is no end date', () => {
    expect(compStatus({ plan: 'pro' }, NOW)).toEqual({ applies: false, endsAt: null, expired: false, daysLeft: null });
    expect(compStatus(null, NOW).applies).toBe(false);
    expect(compStatus({ comp_ends_at: '' }, NOW).applies).toBe(false);
  });

  it('ignores a date it cannot read instead of locking the person out', () => {
    expect(compStatus({ comp_ends_at: 'not a date' }, NOW).applies).toBe(false);
    expect(compStatus({ comp_ends_at: 42 }, NOW).applies).toBe(false);
  });

  it('is active before the end date and counts days left (rounded up)', () => {
    const s = compStatus({ comp_ends_at: '2026-12-10T23:59:59Z' }, NOW);
    expect(s.applies).toBe(true);
    expect(s.expired).toBe(false);
    expect(s.daysLeft).toBe(31);
  });

  it('is expired at and after the end date, with zero days left', () => {
    const at = compStatus({ comp_ends_at: '2026-11-10T12:00:00Z' }, NOW);
    expect(at.expired).toBe(true);
    expect(at.daysLeft).toBe(0);
    expect(compStatus({ comp_ends_at: '2026-10-01T00:00:00Z' }, NOW).expired).toBe(true);
  });

  it('defaults a new comp to 30 days out, at the end of that day', () => {
    const d = defaultCompEnd(NOW);
    expect(d.toISOString()).toBe('2026-12-10T23:59:59.000Z');
  });
});
