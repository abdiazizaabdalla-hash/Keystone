import { AuthError } from './auth';
import { getTeamForUser, getTeamMemberUserIds } from './team';

export const MAX_TEAM_MESSAGE_LENGTH = 2000;
export const BOARD_THREAD = 'board';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MessagingContext {
  teamId: string;
  ownerId: string;
  isOwner: boolean;
  memberIds: string[];
}

/**
 * Everything a messaging request needs to know about the caller's team.
 * Throws 403 if they aren't on one. Team membership (not the plan flag
 * alone) is what grants access, and it's re-read on every request, so a
 * removed member loses access immediately.
 */
export async function getMessagingContext(userId: string): Promise<MessagingContext> {
  const membership = await getTeamForUser(userId);
  if (!membership) {
    throw new AuthError('Team messaging is only available to members of a Team or Brokerage plan.', 403);
  }
  const memberIds = await getTeamMemberUserIds(membership.team.id);
  return {
    teamId: membership.team.id,
    ownerId: membership.team.owner_id,
    isOwner: membership.role === 'owner',
    memberIds,
  };
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
