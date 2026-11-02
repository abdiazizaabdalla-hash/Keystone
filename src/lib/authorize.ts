import { supabaseServer } from './supabase';
import { AuthError } from './auth';
import { getEntitlements } from './entitlements';
import { getVisibleTcUserIds } from './team';
import type { WithAppMetadata } from './appMetadata';

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
  /** May an agent added to this deal (a collaborator) use this route? */
  collaborators: boolean;
  /** 403 message for a coordinator who is not allowed. */
  deniedMessage: string;
}

export interface DealRef {
  id: string;
  agent_id: string;
}

export async function authorizeDeal(
  user: { id: string } & WithAppMetadata,
  isAdmin: boolean,
  transactionId: string,
  { scope, collaborators, deniedMessage }: DealAccessOptions
): Promise<DealRef> {
  const entitlements = getEntitlements(user);
  const isAgentLogin = user.app_metadata?.role === 'agent';

  // An agent login is scoped to exactly the deals they were added to.
  if (isAgentLogin && !isAdmin) {
    if (collaborators) {
      const { data: link } = await supabaseServer
        .from('transaction_agents')
        .select('transaction_id')
        .eq('transaction_id', transactionId)
        .eq('agent_user_id', user.id)
        .maybeSingle();
      if (link) return fetchDeal(transactionId);
    }
    // No link (or a route that is not open to collaborators): only an agent who owns a
    // workspace of their own can fall through to the owner check below.
    if (entitlements.isCollaborator) {
      throw new AuthError(
        collaborators ? 'You do not have access to this transaction' : deniedMessage,
        403
      );
    }
  }

  const deal = await fetchDeal(transactionId);
  if (isAdmin) return deal;

  const ownerIds = scope === 'team' ? await getVisibleTcUserIds(user.id) : [user.id];
  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', deal.agent_id)
    .in('tc_user_id', ownerIds)
    .maybeSingle();
  if (!agent) throw new AuthError(deniedMessage, 403);
  return deal;
}

async function fetchDeal(transactionId: string): Promise<DealRef> {
  const { data, error } = await supabaseServer.from('transactions').select('id, agent_id').eq('id', transactionId).maybeSingle();
  if (error || !data) throw new AuthError('Transaction not found', 404);
  return data as DealRef;
}
