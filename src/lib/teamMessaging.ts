import { AuthError } from './auth';
import { ensureTeamForOwner, getTeamForUser, getTeamMemberUserIds } from './team';
import { activeLinkForAgent, brokerageOn, overseesAgent } from './oversight';

export const MAX_TEAM_MESSAGE_LENGTH = 2000;
export const BOARD_THREAD = 'board';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MessagingContext {
  teamId: string;
  ownerId: string;
  isOwner: boolean;
  memberIds: string[];
  /** True for an agent reaching the brokerage's team board through their brokerage link (not a team member). */
  viaBrokerage: boolean;
}

export interface TeamAccess {
  teamId: string;
  ownerId: string;
  isOwner: boolean;
  viaBrokerage: boolean;
}

/**
 * Which team's board and member list this person may use, and how. Two ways in:
 *   1. They are on the team (owner or member).
 *   2. They are an agent with an active brokerage link to an owner whose plan is still active: they get the
 *      brokerage's board and member list (read access to who is in it, post and read on the board), nothing more.
 * Re-read on every request, so leaving a team or brokerage cuts access immediately.
 */
export async function resolveTeamAccess(userId: string): Promise<TeamAccess | null> {
  const membership = await getTeamForUser(userId);
  if (membership) return { teamId: membership.team.id, ownerId: membership.team.owner_id, isOwner: membership.role === 'owner', viaBrokerage: false };
  if (!brokerageOn()) return null;
  const link = await activeLinkForAgent(userId);
  if (!link || !(await overseesAgent(link.owner_user_id, userId))) return null;
  const ownerTeam = await getTeamForUser(link.owner_user_id);
  const team = ownerTeam ? ownerTeam.team : await ensureTeamForOwner(link.owner_user_id);
  return { teamId: team.id, ownerId: team.owner_id, isOwner: false, viaBrokerage: true };
}

/**
 * Everything a messaging request needs to know about the caller's team.
 * Throws 403 if they aren't on one. Team membership (not the plan flag
 * alone) is what grants access, and it's re-read on every request, so a
 * removed member loses access immediately. A brokerage agent reaches the
 * board only: private threads with them go through /api/brokerage-messages.
 */
export async function getMessagingContext(userId: string): Promise<MessagingContext> {
  const access = await resolveTeamAccess(userId);
  if (!access) {
    throw new AuthError('Team messaging is only available to members of a Team or Brokerage plan.', 403);
  }
  const memberIds = access.viaBrokerage ? [] : await getTeamMemberUserIds(access.teamId);
  return { ...access, memberIds };
}

export type ParsedThread = { kind: 'board' } | { kind: 'dm'; otherId: string };

/**
 * Turns the client's `thread` value ('board' or a teammate's user id) into
 * something safe to query with. A direct-message thread is only valid if
 * the other person is on the caller's own team and isn't the caller. This
 * check is also what makes the ids safe to use inside a PostgREST filter.
 */
export function parseThread(thread: unknown, selfId: string, memberIds: string[]): ParsedThread {
  if (thread === BOARD_THREAD) return { kind: 'board' };
  if (typeof thread === 'string' && UUID_RE.test(thread) && thread !== selfId && memberIds.includes(thread)) {
    return { kind: 'dm', otherId: thread };
  }
  throw new AuthError('That conversation was not found.', 404);
}

export function threadKey(parsed: ParsedThread): string {
  return parsed.kind === 'board' ? BOARD_THREAD : parsed.otherId;
}

/**
 * Logs a database/server error with its real details (Supabase errors are
 * plain objects that print as `{}` otherwise) and, when the cause is that the
 * messaging tables haven't been created yet, returns a clear message for the
 * response instead of a generic failure.
 */
export function describeMessagingError(label: string, error: unknown): { setupMissing: boolean } {
  const e = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  console.error(label, { code: e?.code, message: e?.message, details: e?.details, hint: e?.hint });
  // PGRST205 / 42P01 = "table not found" in PostgREST / Postgres.
  const setupMissing = e?.code === 'PGRST205' || e?.code === '42P01' || /team_message/i.test(e?.message || '') && /not find|does not exist|schema cache/i.test(e?.message || '');
  return { setupMissing };
}

export const SETUP_MISSING_RESPONSE = {
  error: 'Team messaging is not set up yet: the database tables are missing. Run add-team-messaging.sql in Supabase.',
};
