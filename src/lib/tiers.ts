// The tier model for agents and brokerages: who gets which features, how many seats a brokerage has, and where an agent's
// access comes from. Pure (no database, no billing), and NOT wired into any route yet: it is the single place the rules
// will live so that billing, the pilot and the feature gates all read the same answer. See docs/PRICING_ENTITLEMENT_DESIGN.md.
//
// These tiers are new and separate from the TC plans (Starter, Pro, Team). A brokerage owner keeps their TC plan; their
// brokerage tier is a different fact. Two ideas keep this simple:
//  1. A brokerage's tier is a fact about the brokerage owner. An agent's level is derived on read from their own subscription
//     or grant, or from the brokerage or coordinator that invited them. Nothing is copied onto the agent, so when a link ends
//     or a brokerage lapses, the access it granted ends by itself.
//  2. Every capability asks one question (`brokerageHas`, `agentHas`). Billing later only changes what tier a person is
//     resolved to; it never changes a route.
//
// The brokerage tiers differ by the level of operational control (how much you can configure and see), not by the basics.

export type Tier = 'basic' | 'pro';

// ---- Brokerage ----

export type BrokerageFeature =
  | 'dashboard' // roster totals, per-agent open / late / closing this week, last activity
  | 'agent_management' // invite, resend, remove
  | 'deal_visibility' // read-only look at every agent's deals, deadlines, listings, production
  | 'file_review' // required-document review and missing-document flags (one list for the brokerage on Basic)
  | 'team_messaging' // team board, private messages
  | 'commission_statements' // confirm and mark paid, as built today; the wider commission oversight is separate (not offered yet)
  | 'reporting_basic' // agent-by-month production CSV: a fixed summary
  | 'multiple_administrators' // more than one administrator (a small number on Basic, see BROKERAGE_LIMITS)
  | 'compliance_templates_advanced' // several required-document lists by deal type
  | 'reporting_advanced' // configurable, deal-level reports
  | 'advanced_analytics' // trends and comparisons across agents and time
  | 'advanced_permissions'; // scoped roles for administrators

/** Planned, but not part of either tier yet. `brokerageHas` is false for these on every tier until they are built and placed. */
export type UnreleasedBrokerageFeature = 'checklist_policies' | 'commission_oversight';
export const UNRELEASED_BROKERAGE_FEATURES: readonly UnreleasedBrokerageFeature[] = ['checklist_policies', 'commission_oversight'];

const BASIC_BROKERAGE: BrokerageFeature[] = ['dashboard', 'agent_management', 'deal_visibility', 'file_review', 'team_messaging', 'commission_statements', 'reporting_basic', 'multiple_administrators'];
const PRO_BROKERAGE: BrokerageFeature[] = [...BASIC_BROKERAGE, 'compliance_templates_advanced', 'reporting_advanced', 'advanced_analytics', 'advanced_permissions'];

export const BROKERAGE_FEATURES: Record<Tier, readonly BrokerageFeature[]> = { basic: BASIC_BROKERAGE, pro: PRO_BROKERAGE };

/** Agents included with each brokerage tier. Extra seats are added on top. */
export const BROKERAGE_INCLUDED_SEATS: Record<Tier, number> = { basic: 10, pro: 25 };

/**
 * Numeric limits that differ by tier. PROPOSED values, to be confirmed: the plan says only "limited" administrators on Basic.
 * `requiredDocumentLists` is how many separate required-document lists the brokerage can keep (Basic: one for every file).
 */
export const BROKERAGE_LIMITS: Record<Tier, { requiredDocumentLists: number; extraAdministrators: number }> = {
  basic: { requiredDocumentLists: 1, extraAdministrators: 1 },
  pro: { requiredDocumentLists: 10, extraAdministrators: 5 },
};

export const brokerageHas = (tier: Tier, feature: BrokerageFeature | UnreleasedBrokerageFeature): boolean => (BROKERAGE_FEATURES[tier] as readonly string[]).includes(feature);

/** Active agents plus open invitations may not exceed this. Extra seats must be a whole number of zero or more. */
export function brokerageSeatLimit(tier: Tier, extraSeats = 0): number {
  const extra = Number.isInteger(extraSeats) && extraSeats > 0 ? extraSeats : 0;
  return BROKERAGE_INCLUDED_SEATS[tier] + extra;
}

/**
 * Whether another invitation may go out. Pending invitations count toward the limit, so a brokerage cannot over-invite and then
 * be surprised. A brokerage already over its limit (after a downgrade) cannot invite more, but nobody is removed.
 * `inGoodStanding: false` (a lapsed brokerage, see brokeragePilot.ts) also stops new invitations; existing agents and deals are untouched.
 */
export function canInviteAnother(counts: { active: number; pending: number }, tier: Tier, extraSeats = 0, inGoodStanding = true): boolean {
  return inGoodStanding && counts.active + counts.pending < brokerageSeatLimit(tier, extraSeats);
}

// ---- Agent ----

/**
 * What an agent can do:
 *  - none: no access.
 *  - guest: invited by a coordinator (TC) onto specific deals. Works on those deals only; cannot create or run their own. Free.
 *  - basic: brokerage-granted, free to the agent. Runs their own deals, with the brokerage's visibility on top.
 *  - pro: the agent's own paid workspace (or an admin grant): everything in Basic plus their own CRM, follow-ups and templates.
 */
export type AgentLevel = 'none' | 'guest' | 'basic' | 'pro';

export type AgentFeature =
  | 'deal_visibility' // see the deal(s) they are on, key dates and documents
  | 'documents'
  | 'key_dates'
  | 'messaging' // messages on a deal; with a brokerage, also the team board and the broker thread
  | 'own_deals' // create and run their own deals
  | 'crm_contacts'
  | 'follow_ups'
  | 'templates'
  | 'workflow_extras';

const GUEST_AGENT: AgentFeature[] = ['deal_visibility', 'documents', 'key_dates', 'messaging'];
const BASIC_AGENT: AgentFeature[] = [...GUEST_AGENT, 'own_deals'];
const PRO_AGENT: AgentFeature[] = [...BASIC_AGENT, 'crm_contacts', 'follow_ups', 'templates', 'workflow_extras'];

export const AGENT_FEATURES: Record<AgentLevel, readonly AgentFeature[]> = { none: [], guest: GUEST_AGENT, basic: BASIC_AGENT, pro: PRO_AGENT };
export const agentHas = (level: AgentLevel, feature: AgentFeature): boolean => AGENT_FEATURES[level].includes(feature);

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
  level: AgentLevel;
  /** null only when level is 'none'. */
  source: AgentAccessSource | null;
}

/**
 * The agent's level and why they have it. Pro comes only from the agent's own subscription or an admin grant. Otherwise Basic
 * comes free from a brokerage in good standing, and Guest from a coordinator's invitation. A lapsed brokerage stops granting
 * Basic: the agent falls back to Guest if a coordinator invited them, else to none, and the callers keep their existing deals
 * readable (nothing is deleted); they simply cannot start new ones until access is back.
 */
export function resolveAgentAccess(input: AgentTierInput): AgentAccess {
  if (input.ownSubscription) return { level: 'pro', source: 'own_subscription' };
  if (input.adminGrant) return { level: 'pro', source: 'admin_grant' };
  if (input.brokerage?.inGoodStanding) return { level: 'basic', source: 'brokerage' };
  if (input.invitedByCoordinator) return { level: 'guest', source: 'coordinator_invite' };
  return { level: 'none', source: null };
}
