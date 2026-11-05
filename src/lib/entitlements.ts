import { hasAgentRole, isPlatformAdmin, type WithAppMetadata } from './appMetadata';
import { isFeatureOn } from './features';
import type { AgentLevel } from './tiers';
import { hasBrokerageAccess } from './brokerageAccessMeta';

// One place that answers "what kind of account is this, and what may it own?"
//
// Identity (who someone is), entitlement (what they have paid for or been granted)
// and deal participation (which deals they were added to) are three different things.
// This file covers the first two. Deal participation is decided per deal by the
// route (today: transaction_agents and agents.tc_user_id; Phase 3: authorize.ts).
//
// Everything here reads app_metadata only. app_metadata can be written only with the
// service-role key, so a person cannot grant themselves anything by editing their own
// profile (user_metadata).

export type AccountKind =
  /** A platform admin. */
  | 'admin'
  /** A free agent portal login: works on deals a coordinator added them to, owns no workspace. */
  | 'collaborator'
  /** An agent who has been granted their own workspace (Phase 2: set by an admin, later by billing). */
  | 'agent_workspace'
  /** A transaction coordinator (the default). */
  | 'coordinator';

export interface Entitlements {
  kind: AccountKind;
  isAdmin: boolean;
  /** True for a free portal login with no workspace of their own. */
  isCollaborator: boolean;
  /** May create and edit their own transactions, templates, teams and invoices. */
  canOwnWorkspace: boolean;
  /** May be added to another account's deals and work on them. Everyone signed in can. */
  canJoinSharedDeals: true;
  /**
   * The agent tier this account is on (see tiers.ts): guest = a free portal login, basic = a workspace the brokerage provides,
   * pro = a workspace of their own (admin grant today, subscription later). Null for coordinators and admins, who are not agents.
   */
  agentLevel: Exclude<AgentLevel, 'none'> | null;
}

/** app_metadata.agent_workspace === true is the admin's grant of an agent workspace. */
export function hasAgentWorkspace(user: WithAppMetadata | null | undefined): boolean {
  return user?.app_metadata?.agent_workspace === true;
}

export function getEntitlements(user: WithAppMetadata | null | undefined): Entitlements {
  const isAdmin = isPlatformAdmin(user);
  const agentRole = hasAgentRole(user);
  // The grant only counts while the agent_workspace feature is switched on for this environment
  // (see features.ts). In production it is off, so a stored grant changes nothing.
  const workspace = agentRole && hasAgentWorkspace(user) && isFeatureOn('agent_workspace');
  const isCollaborator = agentRole && !workspace;

  const kind: AccountKind = isAdmin ? 'admin' : workspace ? 'agent_workspace' : isCollaborator ? 'collaborator' : 'coordinator';

  const agentLevel: Entitlements['agentLevel'] = kind === 'agent_workspace' ? (hasBrokerageAccess(user) ? 'basic' : 'pro') : kind === 'collaborator' ? 'guest' : null;

  return {
    kind,
    agentLevel,
    isAdmin,
    isCollaborator,
    canOwnWorkspace: !isCollaborator,
    canJoinSharedDeals: true,
  };
}
