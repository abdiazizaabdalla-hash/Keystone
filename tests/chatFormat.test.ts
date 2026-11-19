import { describe, expect, it } from 'vitest';
import { colourIndex, continuesGroup, dayLabel, initials } from '@/lib/chatFormat';

describe('chat helpers', () => {
  it('makes initials from a name or an email', () => {
    expect(initials('Dana Whitfield')).toBe('DW');
    expect(initials('prince')).toBe('P');
    expect(initials('dana.whitfield@example.com')).toBe('DW');
    expect(initials('')).toBe('?');
  });
  it('gives a sender the same colour every time, within range', () => {
    expect(colourIndex('user-1', 6)).toBe(colourIndex('user-1', 6));
    for (const k of ['a', 'b', 'user-123', 'x'.repeat(50)]) expect(colourIndex(k, 6)).toBeGreaterThanOrEqual(0);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => colourIndex(k, 6))).size).toBeGreaterThan(2);
  });
  it('labels days', () => {
    const now = new Date('2026-11-03T15:00:00');
    expect(dayLabel('2026-11-03T09:00:00', now)).toBe('Today');
    expect(dayLabel('2026-11-02T09:00:00', now)).toBe('Yesterday');
    expect(dayLabel('2026-10-20T09:00:00', now)).toMatch(/Oct 20/);
    expect(dayLabel('2025-10-20T09:00:00', now)).toMatch(/2025/);
  });
  it('groups messages from the same sender within five minutes on the same day', () => {
    const a = { senderKey: 'u1', createdAt: '2026-11-03T10:00:00' };
    expect(continuesGroup(undefined, a)).toBe(false);
    expect(continuesGroup(a, { senderKey: 'u1', createdAt: '2026-11-03T10:04:00' })).toBe(true);
    expect(continuesGroup(a, { senderKey: 'u1', createdAt: '2026-11-03T10:06:00' })).toBe(false);
    expect(continuesGroup(a, { senderKey: 'u2', createdAt: '2026-11-03T10:01:00' })).toBe(false);
    expect(continuesGroup(a, { senderKey: 'u1', createdAt: '2026-11-04T10:01:00' })).toBe(false);
  });
});
