import { AuthError } from './auth';
import { supabaseServer } from './supabase';
import { sendBrokerageEmail } from './oversightServer';
import { PilotError, accessFor, convert, daysLeft, effectiveStatus, extend, newPilot, noticeDue, noticeText, seatCheck, terminate, type AccountRow, type AccountStatus } from './brokeragePilot';

// Reads and writes a brokerage's account (tier, seats, pilot). Relay's own record of what was granted: nothing here talks to Stripe.
//
// An owner with NO row is not under entitlement control yet and behaves exactly as before. Every brokerage that is onboarded
// gets a row from an admin (the pilot), and the Admin page lists owners who have agents but no row so none is missed.

export interface AccountFull extends AccountRow {
  owner_user_id: string;
  converted_on: string | null;
  terminated_on: string | null;
  upgrade_requested_at: string | null;
  notes: string | null;
  created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const missingTable = (e: { code?: string } | null | undefined) => e?.code === 'PGRST205' || e?.code === '42P01';

export async function getAccount(ownerId: string): Promise<AccountFull | null> {
  const { data, error } = await supabaseServer.from('brokerage_accounts').select('*').eq('owner_user_id', ownerId).maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return (data as AccountFull | null) ?? null;
}

export async function recordEvent(ownerId: string, kind: string, extra: { endsOn?: string | null; actorId?: string | null; note?: string | null } = {}): Promise<boolean> {
  const { error } = await supabaseServer.from('brokerage_account_events').insert({ owner_user_id: ownerId, kind, ends_on: extra.endsOn ?? null, actor_user_id: extra.actorId ?? null, note: extra.note ?? null });
  if (error?.code === '23505') return false; // this notice was already recorded for this end date
  if (error) throw error;
  return true;
}

const refusal = (status: AccountStatus) =>
  status === 'terminated'
    ? 'This brokerage account is paused. Your agents and records are untouched. Contact Relay to reopen it.'
    : 'Your pilot has ended. Your agents, deals and records are all still here and readable, but managing the brokerage is paused. Request an upgrade to Brokerage Pro to continue.';

/** Throws 403 when this brokerage's account is read-only (pilot over or terminated). No account row means no restriction. */
export async function assertBrokerageManageable(ownerId: string): Promise<void> {
  const account = await getAccount(ownerId);
  if (!account) return;
  const access = accessFor(account, today());
  if (!access.canManage) throw new AuthError(refusal(access.status), 403);
}

/** Throws before another invitation when the account is read-only or full. No account row means the old fixed cap applies elsewhere. */
export async function assertCanInvite(ownerId: string, counts: { active: number; pending: number }): Promise<void> {
  const account = await getAccount(ownerId);
  if (!account) return;
  const check = seatCheck(account, counts, today());
  if (check.ok) return;
  if (check.reason === 'seat_limit') throw new AuthError(`Your plan includes ${check.limit} agents, counting invitations that are still open. Remove an agent or cancel an invitation, or ask Relay for more seats.`, 400);
  throw new AuthError(refusal(effectiveStatus(account, today())), 403);
}

/** A bell notification and an email to the owner. Never throws. */
export async function tellOwner(ownerId: string, actorId: string | null, source: string, title: string, paragraphs: string[]): Promise<void> {
  try {
    await supabaseServer.from('notifications').insert({ recipient_user_id: ownerId, actor_user_id: actorId ?? ownerId, event_type: 'brokerage_account', title: title.slice(0, 200), link: '/dashboard/collaborate' });
    await sendBrokerageEmail({ outboxOwnerId: ownerId, fromLabel: 'Relay TC', to: { userId: ownerId }, source, subject: title, paragraphs, path: '/dashboard/collaborate', linkLabel: 'Open your brokerage' });
  } catch (error) {
    console.error('Brokerage account notice failed:', error);
  }
}

// ---- Admin actions ----

const fmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

async function save(ownerId: string, changes: Record<string, unknown>) {
  const { error } = await supabaseServer.from('brokerage_accounts').update({ ...changes, updated_at: new Date().toISOString() }).eq('owner_user_id', ownerId);
  if (error) throw error;
}

/** Starts the 30-day complimentary Pro pilot. The owner must already be on a Team plan (the shared-workspace plan a brokerage uses). */
export async function grantPilot(ownerId: string, adminId: string, note: string | null): Promise<AccountFull> {
  if (await getAccount(ownerId)) throw new PilotError('This brokerage already has an account. Use extend, convert or terminate.');
  const pilot = newPilot(today());
  const { error } = await supabaseServer.from('brokerage_accounts').insert({ owner_user_id: ownerId, ...pilot, notes: note });
  if (error) throw error;
  await recordEvent(ownerId, 'granted', { endsOn: pilot.pilot_ends_on, actorId: adminId, note });
  await tellOwner(ownerId, adminId, 'brokerage_pilot_granted', 'Your 30-day Brokerage Pro pilot has started', [
    `Your complimentary Brokerage Pro pilot is live and runs until ${fmt(pilot.pilot_ends_on)}. It includes up to 25 agents and every Pro feature.`,
    'No payment method is needed, you will not be charged, and nothing renews automatically. We will remind you 14, 7 and 3 days before it ends.',
  ]);
  return (await getAccount(ownerId))!;
}

export type AdminAction = 'extend' | 'convert' | 'terminate';

export async function applyAdminAction(ownerId: string, adminId: string, action: AdminAction, note: string | null): Promise<AccountFull> {
  const account = await getAccount(ownerId);
  if (!account) throw new PilotError('This brokerage has no account yet. Grant a pilot first.', 404);
  const now = today();
  if (action === 'extend') {
    const changes = extend(account, now);
    await save(ownerId, changes);
    await recordEvent(ownerId, 'extended', { endsOn: changes.pilot_ends_on ?? null, actorId: adminId, note });
    await tellOwner(ownerId, adminId, 'brokerage_pilot_extended', 'Your Brokerage Pro pilot was extended by 15 days', [`Your pilot now runs until ${fmt(changes.pilot_ends_on ?? null)}. Still no payment and no automatic billing.`]);
  } else if (action === 'convert') {
    const changes = convert(account, now);
    await save(ownerId, changes);
    await recordEvent(ownerId, 'converted', { actorId: adminId, note });
    await tellOwner(ownerId, adminId, 'brokerage_pilot_converted', 'Welcome to Brokerage Pro', ['Your brokerage is now on Brokerage Pro: up to 25 agents and every Pro feature, with nothing paused.']);
  } else {
    const changes = terminate(account, now);
    await save(ownerId, changes);
    await recordEvent(ownerId, 'terminated', { actorId: adminId, note });
    await tellOwner(ownerId, adminId, 'brokerage_account_terminated', 'Your brokerage account was paused', ['Your agents, deals and records are untouched and stay readable. Managing the brokerage is paused. Contact Relay to reopen it.']);
  }
  return (await getAccount(ownerId))!;
}

/** The owner asks to upgrade. Recorded for the admin and every platform admin gets a bell. Idempotent per request. */
export async function requestUpgrade(ownerId: string, ownerLabel: string): Promise<void> {
  const account = await getAccount(ownerId);
  if (!account) throw new AuthError('Not found', 404);
  if (!accessFor(account, today()).canRequestUpgrade) throw new PilotError('There is nothing to upgrade.');
  await save(ownerId, { upgrade_requested_at: new Date().toISOString() });
  await recordEvent(ownerId, 'upgrade_requested', { actorId: ownerId });
  const { data } = await supabaseServer.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const admins = (data?.users ?? []).filter((u) => (u.app_metadata as { is_admin?: boolean } | null)?.is_admin === true);
  for (const a of admins) {
    await supabaseServer.from('notifications').insert({ recipient_user_id: a.id, actor_user_id: ownerId, event_type: 'brokerage_upgrade_request', title: `${ownerLabel} asked to upgrade to Brokerage Pro`.slice(0, 200), link: '/dashboard/admin' });
  }
}

// ---- The nightly job ----

/** Sends the 14, 7 and 3 day notices, ends pilots whose date has come (notice + recorded status), and returns what it did. */
export async function runPilotLifecycle(todayIso: string): Promise<{ checked: number; notices: number; expired: number }> {
  const { data, error } = await supabaseServer.from('brokerage_accounts').select('*').in('status', ['pilot']);
  if (error) {
    if (missingTable(error)) return { checked: 0, notices: 0, expired: 0 };
    throw error;
  }
  let notices = 0;
  let expired = 0;
  for (const row of (data ?? []) as AccountFull[]) {
    const endsOn = row.pilot_ends_on;
    if (!endsOn) continue;
    const left = effectiveStatus(row, todayIso) === 'pilot' ? daysLeft(row, todayIso) ?? 0 : 0;
    const { data: events } = await supabaseServer.from('brokerage_account_events').select('kind').eq('owner_user_id', row.owner_user_id).eq('ends_on', endsOn).like('kind', 'notice_%');
    const sent = new Set((events ?? []).map((e) => Number(String(e.kind).replace('notice_', ''))));
    const due = noticeDue(left, sent);
    for (const d of due.skip) await recordEvent(row.owner_user_id, `notice_${d}`, { endsOn, note: 'skipped' });
    if (due.send !== null && (await recordEvent(row.owner_user_id, `notice_${due.send}`, { endsOn }))) {
      const text = noticeText(due.send, fmt(endsOn));
      await tellOwner(row.owner_user_id, null, `brokerage_pilot_notice_${due.send}`, text.title, text.paragraphs);
      notices += 1;
    }
    if (effectiveStatus(row, todayIso) === 'pilot_expired') {
      await save(row.owner_user_id, { status: 'pilot_expired' });
      await recordEvent(row.owner_user_id, 'expired', { endsOn });
      expired += 1;
    }
  }
  return { checked: (data ?? []).length, notices, expired };
}
