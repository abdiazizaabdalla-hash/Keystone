import { supabaseServer } from './supabase';
import { AuthError } from './auth';
import { getEntitlements } from './entitlements';
import { getVisibleTcUserIds } from './team';
import type { WithAppMetadata } from './appMetadata';
import { assertTrialActive, TrialExpiredError } from './trial';

// The one place that answers "may this person touch this deal?".
//
// Who can reach a deal today (and the only ways in):
//   - a platform admin: any deal;
//   - the coordinator who owns it: the deal's agent profile belongs to them
//     (agents.tc_user_id), or for team-wide READS, to someone on their team;
//   - an agent they added to the deal (a transaction_agents row), but only on routes that
//     opt in with `collaborators: true`, and never for owner-only actions.
//
// Phase 3 (shared deals in both directions) adds new ways in (transaction_participants)
// by changing this function, not every route. Until then it keeps exactly today's rules.

export interface DealAccessOptions {
  /**
   * 'team'  = the owner or anyone in the owner's visible team (reads).
   * 'owner' = the owner only (writes, messaging).
   */
  scope: 'team' | 'owner';
  /**
   * People who were added to the deal (a row in transaction_agents) rather than owning it:
   *   'none' = refused;
   *   'any'  = every participant, free or paid (what an invited agent may do: message, upload, tick steps);
   *   'full' = only participants who are on a paid account or active trial (coordinator-level editing).
   */
  participants?: 'none' | 'any' | 'full';
  /** Older spelling of participants: true = 'any'. */
  collaborators?: boolean;
  /** 403 message for a coordinator who is not allowed. */
  deniedMessage: string;
}

export interface DealRef {
  id: string;
  agent_id: string;
}

/**
 * Is this participant on a paid account or active trial ('full'), or free ('limited')?
 * Free agents are always limited. A coordinator or agent workspace whose trial has ended
 * unpaid drops to limited until they pay; nothing is stored, it is worked out per request.
 */
export async function participantLevel(user: { id: string; created_at: string } & WithAppMetadata): Promise<'full' | 'limited'> {
  if (getEntitlements(user).isCollaborator) return 'limited';
  try {
    await assertTrialActive(user);
    return 'full';
  } catch (error) {
    if (error instanceof TrialExpiredError) return 'limited';
    throw error;
  }
}

async function hasParticipantLink(userId: string, transactionId: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('transaction_agents')
    .select('transaction_id')
    .eq('transaction_id', transactionId)
    .eq('agent_user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * For the older helper functions that only have a user id: is this person on the deal as a
 * participant with coordinator-level (paid or trial) editing rights?
 */
export async function isFullParticipant(userId: string, transactionId: string): Promise<boolean> {
  if (!(await hasParticipantLink(userId, transactionId))) return false;
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  if (!data.user) return false;
  return (await participantLevel(data.user)) === 'full';
}

export async function authorizeDeal(
  user: { id: string; created_at?: string } & WithAppMetadata,
  isAdmin: boolean,
  transactionId: string,
  { scope, participants, collaborators, deniedMessage }: DealAccessOptions
): Promise<DealRef> {
  const mode = participants ?? (collaborators ? 'any' : 'none');
  const canOwn = getEntitlements(user).canOwnWorkspace;

  if (isAdmin) return fetchDeal(transactionId);

  // The owner (or, for reads, their team).
  let deal: DealRef | null = null;
  if (canOwn) {
    deal = await findDeal(transactionId);
    if (deal) {
      const ownerIds = scope === 'team' ? await getVisibleTcUserIds(user.id) : [user.id];
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', deal.agent_id)
        .in('tc_user_id', ownerIds)
        .maybeSingle();
      if (agent) return deal;
    }
  }

  // Someone added to the deal.
  if (mode !== 'none' && (await hasParticipantLink(user.id, transactionId))) {
    if (mode === 'any') return deal ?? fetchDeal(transactionId);
    if ((await participantLevel(user as { id: string; created_at: string } & WithAppMetadata)) === 'full') return deal ?? fetchDeal(transactionId);
  }

  if (canOwn && !deal) throw new AuthError('Transaction not found', 404);
  throw new AuthError(canOwn ? deniedMessage : mode !== 'none' ? 'You do not have access to this transaction' : deniedMessage, 403);
}

async function findDeal(transactionId: string): Promise<DealRef | null> {
  const { data } = await supabaseServer.from('transactions').select('id, agent_id').eq('id', transactionId).maybeSingle();
  return (data as DealRef | null) ?? null;
}

async function fetchDeal(transactionId: string): Promise<DealRef> {
  const deal = await findDeal(transactionId);
  if (!deal) throw new AuthError('Transaction not found', 404);
  return deal;
}

/**
 * Is this person acting as an invited agent (a collaborator) on this particular deal?
 *
 *  - coordinators and admins: never;
 *  - a free agent login: always (they own nothing);
 *  - an agent with a workspace: only on deals they do not own. On their own deals they act as
 *    the owner, like a coordinator.
 */
export async function actsAsCollaborator(
  user: { id: string } & WithAppMetadata,
  isAdmin: boolean,
  transactionId: string
): Promise<boolean> {
  if (isAdmin) return false;
  if (user.app_metadata?.role !== 'agent') return false;
  if (getEntitlements(user).isCollaborator) return true;
  const { data: tx } = await supabaseServer.from('transactions').select('agent_id').eq('id', transactionId).maybeSingle();
  if (!tx) return true;
  const { data: own } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', tx.agent_id)
    .eq('tc_user_id', user.id)
    .maybeSingle();
  return !own;
}

/**
 * Trial gate for routes that agent logins share with coordinators. Coordinators are checked
 * by their route as before. A collaborator working a deal they were added to has no trial of
 * their own. An agent with a workspace working their own deal is held to their trial.
 */
export async function assertTrialForOwnWork(
  user: { id: string; created_at: string } & WithAppMetadata,
  isAdmin: boolean,
  transactionId: string
): Promise<void> {
  if (isAdmin || user.app_metadata?.role !== 'agent') return;
  if (await actsAsCollaborator(user, isAdmin, transactionId)) return;
  await assertTrialActive(user);
}
