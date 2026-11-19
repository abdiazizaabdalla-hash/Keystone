// A complimentary period on a paid plan, set by hand by an admin ("Pro free until 10 Dec, then payment is needed").
// It is stored as `comp_ends_at` in app_metadata, next to `plan`. Pure on purpose, so it can be unit tested and used
// by both the server (lib/trial.ts) and the admin screens. It says nothing about whether the person is paying:
// callers check for an active subscription on that plan first, because paying always clears the lock.

export interface CompStatus {
  /** An end date is set (and it is a valid date). */
  applies: boolean;
  endsAt: Date | null;
  expired: boolean;
  /** Whole days left, rounded up; null when no end date is set. */
  daysLeft: number | null;
}

const DAY = 24 * 60 * 60 * 1000;

export function compStatus(appMetadata: Record<string, unknown> | null | undefined, now: number = Date.now()): CompStatus {
  const raw = appMetadata?.comp_ends_at;
  if (typeof raw !== 'string' || !raw) return { applies: false, endsAt: null, expired: false, daysLeft: null };
  const endsAt = new Date(raw);
  if (Number.isNaN(endsAt.getTime())) return { applies: false, endsAt: null, expired: false, daysLeft: null };
  return {
    applies: true,
    endsAt,
    expired: now >= endsAt.getTime(),
    daysLeft: Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY)),
  };
}

/** The default for "upgrade, pay after a month": 30 days from now, to the end of that day (UTC). */
export function defaultCompEnd(now: number = Date.now(), days = 30): Date {
  const d = new Date(now + days * DAY);
  d.setUTCHours(23, 59, 59, 0);
  return d;
}
