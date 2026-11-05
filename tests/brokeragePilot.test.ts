import { describe, expect, it } from 'vitest';
import { PilotError, accessFor, addDays, convert, daysLeft, effectiveStatus, extend, newPilot, noticeDue, noticeText, seatCheck, terminate, type AccountRow } from '@/lib/brokeragePilot';

const today = '2026-11-05';
const pilot = (over: Partial<AccountRow> = {}): AccountRow => ({ ...newPilot(today), ...over });

describe('a new pilot', () => {
  it('is 30 days of Brokerage Pro with up to 25 agents and no extension used', () => {
    const p = newPilot(today);
    expect(p).toMatchObject({ status: 'pilot', tier: 'pro', pilot_started_on: '2026-11-05', pilot_ends_on: '2026-12-05', extension_used: false });
    expect(accessFor(pilot(), today)).toMatchObject({ status: 'pilot', tier: 'pro', canManage: true, seatLimit: 25, daysLeft: 30 });
  });
  it('counts down and expires on the end date even before any job records it', () => {
    expect(daysLeft(pilot(), '2026-11-25')).toBe(10);
    expect(daysLeft(pilot(), '2026-12-04')).toBe(1);
    expect(effectiveStatus(pilot(), '2026-12-04')).toBe('pilot');
    expect(effectiveStatus(pilot(), '2026-12-05')).toBe('pilot_expired');
    expect(daysLeft(pilot(), '2026-12-05')).toBeNull();
  });
});

describe('after the pilot ends: preserve everything, stop managing, offer an upgrade', () => {
  const expired = accessFor(pilot(), '2026-12-06');
  it('is read-only with no tier and no seats, but keeps data, messaging and exports', () => {
    expect(expired).toMatchObject({ status: 'pilot_expired', tier: null, canManage: false, readOnly: true, keepsData: true, canMessage: true, canExport: true, seatLimit: 0, canRequestUpgrade: true });
  });
  it('cannot invite once expired or terminated, and the seat limit applies while active', () => {
    expect(seatCheck(pilot(), { active: 24, pending: 0 }, today)).toMatchObject({ ok: true, limit: 25 });
    expect(seatCheck(pilot(), { active: 24, pending: 1 }, today)).toMatchObject({ ok: false, reason: 'seat_limit' });
    expect(seatCheck(pilot(), { active: 1, pending: 0 }, '2026-12-06')).toMatchObject({ ok: false, reason: 'not_managing' });
    expect(seatCheck(pilot({ status: 'terminated' }), { active: 1, pending: 0 }, today)).toMatchObject({ ok: false, reason: 'not_managing' });
  });
  it('a converted account is back to full Pro and is not asked to upgrade again', () => {
    const c = pilot({ status: 'converted' });
    expect(accessFor(c, '2027-06-01')).toMatchObject({ status: 'converted', tier: 'pro', canManage: true, seatLimit: 25, canRequestUpgrade: false });
  });
});

describe('admin actions', () => {
  it('extends once by 15 days: from the end date while active, from today once expired', () => {
    expect(extend(pilot(), '2026-11-30')).toMatchObject({ status: 'pilot', pilot_ends_on: '2026-12-20', extension_used: true });
    expect(extend(pilot(), '2026-12-10')).toMatchObject({ status: 'pilot', pilot_ends_on: '2026-12-25', extension_used: true });
    expect(() => extend(pilot({ extension_used: true }), today)).toThrow(PilotError);
    expect(() => extend(pilot({ status: 'converted' }), today)).toThrow(PilotError);
    expect(() => extend(pilot({ status: 'terminated' }), today)).toThrow(PilotError);
  });
  it('converts a pilot or an expired pilot to Pro, and records the date; it does nothing else', () => {
    expect(convert(pilot(), today)).toEqual({ status: 'converted', tier: 'pro', converted_on: today });
    expect(convert(pilot(), '2027-01-01')).toMatchObject({ status: 'converted' });
    expect(() => convert(pilot({ status: 'converted' }), today)).toThrow(PilotError);
    expect(() => convert(pilot({ status: 'terminated' }), today)).toThrow(PilotError);
  });
  it('terminates once', () => {
    expect(terminate(pilot(), today)).toEqual({ status: 'terminated', terminated_on: today });
    expect(() => terminate(pilot({ status: 'terminated' }), today)).toThrow(PilotError);
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
  });
});

describe('expiry notices at 14, 7, 3 days and on the day', () => {
  it('sends each once, on its day', () => {
    expect(noticeDue(14, new Set())).toEqual({ send: 14, skip: [] });
    expect(noticeDue(13, new Set([14]))).toEqual({ send: null, skip: [] });
    expect(noticeDue(7, new Set([14]))).toEqual({ send: 7, skip: [] });
    expect(noticeDue(3, new Set([14, 7]))).toEqual({ send: 3, skip: [] });
    expect(noticeDue(0, new Set([14, 7, 3]))).toEqual({ send: 0, skip: [] });
    expect(noticeDue(20, new Set())).toEqual({ send: null, skip: [] });
  });
  it('after a missed night sends only the most urgent and skips the older ones', () => {
    expect(noticeDue(6, new Set([14]))).toEqual({ send: 7, skip: [] });
    expect(noticeDue(2, new Set([14]))).toEqual({ send: 3, skip: [7] });
    expect(noticeDue(0, new Set())).toEqual({ send: 0, skip: [14, 7, 3] });
  });
  it('says plainly that nothing is charged and nothing was deleted', () => {
    expect(noticeText(7, '2026-12-05').paragraphs.join(' ')).toMatch(/not charged.*nothing renews/);
    expect(noticeText(0, '2026-12-05').paragraphs.join(' ')).toMatch(/Nothing was deleted/);
  });
});
