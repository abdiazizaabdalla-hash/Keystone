// The tier model for agents and brokerages: who gets which features, how many seats a brokerage has, and where an agent's
// access comes from. Pure (no database, no billing), and NOT wired into any route yet: it is the single place the rules
// will live so that billing, the pilot and the feature gates all read the same answer. See docs/PRICING_ENTITLEMENT_DESIGN.md.
//
// Two ideas keep this simple:
//  1. A brokerage's tier is a fact about the brokerage owner. An agent's tier is derived on read from their own subscription
//     or grant, or from the brokerage that invited them. Nothing is copied onto the agent, so when the link ends or the
//     brokerage lapses, the brokerage-granted access ends by itself.
//  2. Every capability asks one question (`brokerageHas`, `agentHas`). Billing later only changes what tier a person is
//     resolved to; it never changes a route.

export type Tier = 'basic' | 'pro';

/** Where an account's tier comes from. 'pilot' is the complimentary manual onboarding; billing adds 'subscription'. */
export type TierSource = 'pilot' | 'subscription' | 'admin';

// ---- Brokerage ----

export type BrokerageFeature =
  | 'agent_management' // invite, remove, roster
  | 'deal_visibility' // read-only look at every agent's deals, deadlines, production
  | 'file_review' // required documents, reviewed / flagged
  | 'compliance_tracking' // late items, closing this week, weekly digest
  | 'team_messaging' // team board, private messages
  | 'commission_statements' // confirm and mark paid
  | 'advanced_compliance' // reserved: richer compliance workflows
  | 'reporting' // production CSV by agent and month, and later reports
  | 'admin_permissions' // reserved: more than one administrator, scoped roles
  | 'checklist_management'; // reserved: brokerage-wide checklist push

const BASIC_BROKERAGE: BrokerageFeature[] = ['agent_management', 'deal_visibility', 'file_review', 'compliance_tracking', 'team_messaging', 'commission_statements'];
const PRO_BROKERAGE: BrokerageFeature[] = [...BASIC_BROKERAGE, 'advanced_compliance', 'reporting', 'admin_permissions', 'checklist_management'];

export const BROKERAGE_FEATURES: Record<Tier, readonly BrokerageFeature[]> = { basic: BASIC_BROKERAGE, pro: PRO_BROKERAGE };

/** Agents included with each brokerage tier. Extra seats are added on top. */
export const BROKERAGE_INCLUDED_SEATS: Record<Tier, number> = { basic: 10, pro: 25 };

export const brokerageHas = (tier: Tier, feature: BrokerageFeature): boolean => BROKERAGE_FEATURES[tier].includes(feature);

/** Active agents plus open invitations may not exceed this. Extra seats must be a whole number of zero or more. */
export function brokerageSeatLimit(tier: Tier, extraSeats = 0): number {
  const extra = Number.isInteger(extraSeats) && extraSeats > 0 ? extraSeats : 0;
  return BROKERAGE_INCLUDED_SEATS[tier] + extra;
}

/**
 * Whether another invitation may go out. Pending invitations count toward the limit, so a brokerage cannot over-invite and then
 * be surprised. A brokerage already over its limit (after a downgrade) cannot invite more, but nobody is removed.
 */
export function canInviteAnother(counts: { active: number; pending: number }, tier: Tier, extraSeats = 0): boolean {
  return counts.active + counts.pending < brokerageSeatLimit(tier, extraSeats);
}

// ---- Agent ----

export type AgentFeature =
  | 'deal_visibility' // see their deals, key dates and documents
  | 'documents'
  | 'key_dates'
  | 'messaging' // broker or TC messages, team board
  | 'own_deals' // create and run their own deals
  | 'crm_contacts'
  | 'follow_ups'
  | 'templates'
  | 'workflow_extras';

const BASIC_AGENT: AgentFeature[] = ['deal_visibility', 'documents', 'key_dates', 'messaging', 'own_deals'];
const PRO_AGENT: AgentFeature[] = [...BASIC_AGENT, 'crm_contacts', 'follow_ups', 'templates', 'workflow_extras'];

export const AGENT_FEATURES: Record<Tier, readonly AgentFeature[]> = { basic: BASIC_AGENT, pro: PRO_AGENT };
export const agentHas = (tier: Tier, feature: AgentFeature): boolean => AGENT_FEATURES[tier].includes(feature);

export type AgentAccessSource = 'own_subscription' | 'admin_grant' | 'brokerage' | 'coordinator_invite';

export interface AgentTierInput {
  /** The agent pays for Agent Pro themselves (set by billing later). */
  ownSubscription: boolean;
  /** An admin granted this agent a Pro workspace (today's agent_workspace grant). */
  adminGrant: boolean;
  /** The active brokerage link, if any, and whether that brokerage is in good standing (plan active or pilot). */
  brokerage: { inGoodStanding: boolean } | null;
  /** A coordinator added the agent to a deal (the free portal login). */
  invitedByCoordinator: boolean;
}

export interface AgentAccess {
  tier: Tier;
  /** null means no access at all (not invited by anyone and not subscribed). */
  source: AgentAccessSource | null;
}

/**
 * The agent's tier and why they have it. Pro always wins and comes from the agent's own subscription or an admin grant. Otherwise
 * Basic comes free from a brokerage in good standing or from a coordinator's invitation. A brokerage that lapses stops
 * granting Basic, and the agent keeps Pro only if they pay for it themselves.
 */
export function resolveAgentAccess(input: AgentTierInput): AgentAccess {
  if (input.ownSubscription) return { tier: 'pro', source: 'own_subscription' };
  if (input.adminGrant) return { tier: 'pro', source: 'admin_grant' };
  if (input.brokerage?.inGoodStanding) return { tier: 'basic', source: 'brokerage' };
  if (input.invitedByCoordinator) return { tier: 'basic', source: 'coordinator_invite' };
  return { tier: 'basic', source: null };
}

/** Whether a brokerage account is in good standing: a pilot account is, and a subscription is while it is active. */
export function brokerageInGoodStanding(account: { source: TierSource; subscriptionActive?: boolean; pilotEndsOn?: string | null }, today: string): boolean {
  if (account.source === 'pilot') return !account.pilotEndsOn || account.pilotEndsOn >= today;
  if (account.source === 'admin') return true;
  return account.subscriptionActive === true;
}
