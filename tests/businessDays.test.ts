import { describe, it, expect } from 'vitest';
import { addBusinessDays, addCalendarDays, addDays } from '@/lib/businessDays';

describe('business days', () => {
  it('skips weekends going forward', () => {
    expect(addBusinessDays('2026-11-13', 1)).toBe('2026-11-16'); // Friday -> Monday
    expect(addBusinessDays('2026-11-10', 5)).toBe('2026-11-17'); // Tuesday + 5
  });
  it('skips weekends going back', () => {
    expect(addBusinessDays('2026-11-16', -1)).toBe('2026-11-13'); // Monday -> Friday
  });
  it('zero from a weekend lands on Monday, zero from a weekday stays', () => {
    expect(addBusinessDays('2026-11-14', 0)).toBe('2026-11-16');
    expect(addBusinessDays('2026-11-11', 0)).toBe('2026-11-11');
  });
  it('calendar days are plain', () => {
    expect(addCalendarDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-11-13', 2, false)).toBe('2026-11-15');
    expect(addDays('2026-11-13', 2, true)).toBe('2026-11-17');
  });
});
