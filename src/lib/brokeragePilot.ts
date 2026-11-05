import { brokerageSeatLimit, canInviteAnother, type Tier } from './tiers';

// The complimentary pilot and the account lifecycle of a brokerage. Pure (no database, no email, no Stripe), so every rule can be
// tested. Nothing here creates a subscription or a charge: converting a pilot only records that Relay has granted the paid plan.
//
// A pilot is 30 days of full Brokerage Pro (up to 25 agents), starting the day an admin grants it, with no payment method, no
// automatic billing and no automatic renewal. It can be extended once, by 15 days, by an admin. Dates are YYYY-MM-DD (UTC).

export const PILOT_DAYS = 30;
export const EXTENSION_DAYS = 15;
/** Days before the end when the owner is told, and 0 for the day it ends. */
export const NOTICE_DAYS = [14, 7, 3, 0] as const;

export type AccountStatus = 'pilot' | 'pilot_expired' | 'converted' | 'terminated';

export interface AccountRow {
  status: AccountStatus;
  tier: Tier;
  extra_seats: number;
  pilot_started_on: string | null;
  pilot_ends_on: string | null;
  extension_used: boolean;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

/** A new pilot: Pro, 30 days from `today`. The last full day is the day before `pilot_ends_on`. */
export function newPilot(today: string): Pick<AccountRow, 'status' | 'tier' | 'extra_seats' | 'pilot_started_on' | 'pilot_ends_on' | 'extension_used'> {
  return { status: 'pilot', tier: 'pro', extra_seats: 0, pilot_started_on: today, pilot_ends_on: addDays(today, PILOT_DAYS), extension_used: false };
}

/**
 * The status that applies today. A pilot whose end date has come is expired even before the nightly job has recorded it, so
 * access never depends on the job having run.
 */
export function effectiveStatus(row: Pick<AccountRow, 'status' | 'pilot_ends_on'>, today: string): AccountStatus {
  if (row.status === 'pilot' && row.pilot_ends_on && today >= row.pilot_ends_on) return 'pilot_expired';
  return row.status;
}

/** Whole days left in a pilot (30 on the first day, 0 on the end date). Null when there is no end date. */
export function daysLeft(row: Pick<AccountRow, 'status' | 'pilot_ends_on'>, today: string): number | null {
  if (effectiveStatus(row, today) !== 'pilot' || !row.pilot_ends_on) return null;
  return Math.max(0, daysBetween(today, row.pilot_ends_on));
}

/**
 * What an account may do today.
 *  - pilot and converted: the full tier, with the seat allowance.
 *  - pilot_expired and terminated: the downgrade policy. Everything is kept (agents, deals, files, reviews, commission records,
 *    messages) and stays readable and exportable, messaging continues, but managing the brokerage stops: no invitations, no
 *    file-review or commission changes, no Pro-only features. Upgrading restores it.
 */
export function accessFor(row: AccountRow, today: string) {
  const status = effectiveStatus(row, today);
  const managing = status === 'pilot' || status === 'converted';
  return {
    status,
    tier: managing ? row.tier : null,
    canManage: managing,
    readOnly: !managing,
    keepsData: true,
    canMessage: true,
    canExport: true,
    seatLimit: managing ? brokerageSeatLimit(row.tier, row.extra_seats) : 0,
    daysLeft: daysLeft(row, today),
    canRequestUpgrade: status === 'pilot' || status === 'pilot_expired',
  };
}

export function seatCheck(row: AccountRow, counts: { active: number; pending: number }, today: string): { ok: boolean; reason?: 'not_managing' | 'seat_limit'; limit: number } {
  const a = accessFor(row, today);
  if (!a.canManage) return { ok: false, reason: 'not_managing', limit: a.seatLimit };
  if (!canInviteAnother(counts, row.tier, row.extra_seats)) return { ok: false, reason: 'seat_limit', limit: a.seatLimit };
  return { ok: true, limit: a.seatLimit };
}

export class PilotError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

/** One 15-day extension, by an admin. From an active pilot it adds to the end date; from an expired one it restarts for 15 days. */
export function extend(row: AccountRow, today: string): Partial<AccountRow> {
  const status = effectiveStatus(row, today);
  if (status !== 'pilot' && status !== 'pilot_expired') throw new PilotError('Only a pilot can be extended.');
  if (row.extension_used) throw new PilotError('This pilot was already extended once.');
  const from = status === 'pilot' && row.pilot_ends_on ? row.pilot_ends_on : today;
  return { status: 'pilot', pilot_ends_on: addDays(from, EXTENSION_DAYS), extension_used: true };
}

/** Explicit conversion: Relay now treats the account as the paid Pro plan. Records the decision only; no charge is made here. */
export function convert(row: AccountRow, today: string): Partial<AccountRow> & { converted_on: string } {
  const status = effectiveStatus(row, today);
  if (status !== 'pilot' && status !== 'pilot_expired') throw new PilotError('Only a pilot can be converted.');
  return { status: 'converted', tier: 'pro', converted_on: today };
}

export function terminate(row: AccountRow, today: string): Partial<AccountRow> & { terminated_on: string } {
  if (row.status === 'terminated') throw new PilotError('This account is already terminated.');
  return { status: 'terminated', terminated_on: today };
}

/**
 * Which expiry notice to send now. `sent` is the set of notice days already sent for this end date. Sends only the most urgent
 * one that is due, and marks the older ones as skipped, so a missed night never produces a flood.
 */
export function noticeDue(daysLeftNow: number, sent: ReadonlySet<number>): { send: number | null; skip: number[] } {
  const due = NOTICE_DAYS.filter((d) => daysLeftNow <= d && !sent.has(d));
  if (due.length === 0) return { send: null, skip: [] };
  const send = Math.min(...due);
  return { send, skip: due.filter((d) => d !== send) };
}

/** The copy for a notice, so the email and the bell say the same thing. */
export function noticeText(day: number, endsOn: string): { title: string; paragraphs: string[] } {
  if (day === 0) {
    return {
      title: 'Your Brokerage Pro pilot has ended',
      paragraphs: [
        'Your 30-day Brokerage Pro pilot has ended. Nothing was deleted: your agents, their deals, your file reviews, commission records and messages are all still here and readable.',
        'Managing the brokerage (inviting agents, file review, commission actions and the Pro tools) is paused. Upgrade to Brokerage Pro to pick up where you left off.',
      ],
    };
  }
  return {
    title: `Your Brokerage Pro pilot ends in ${day} days`,
    paragraphs: [
      `Your complimentary Brokerage Pro pilot ends on ${endsOn}, in ${day} days. You are not charged and nothing renews automatically.`,
      'To keep managing your brokerage after that, upgrade to Brokerage Pro. If you want to give the pilot more time, tell us and we will review it.',
    ],
  };
}
