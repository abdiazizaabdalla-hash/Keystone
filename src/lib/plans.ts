// Single source of truth for Relay's plan tiers: pricing, onboarding, and
// the auth page all read from here so their copy and plan ids can't drift
// apart, and the API routes read the `limits` below to actually enforce
// what the marketing pages promise.
//
// Pro/Team upgrades go through Stripe Checkout (/api/stripe/checkout) and
// are only granted once Stripe's webhook confirms payment — see
// stripe/webhook/route.ts. `limits` below is what the API routes actually
// enforce; the pricing/onboarding copy is just a rendering of this array.
// Team has its own real shared-workspace model (src/lib/team.ts): a 3-seat
// roster with owner/member visibility, invites, and per-agent payment
// overrides — it is no longer just Pro with a different label.
//
// Starter is no longer free indefinitely: new signups (see
// src/lib/trial.ts for the exact cutoff) get a 30-day-or-first-paid-deal
// trial, then have to add payment to keep using it at $10/month, through
// the same Stripe Checkout flow as Pro/Team (see src/lib/stripe.ts). The
// `limits` below (unlimited transactions, up to 3 agents, no custom
// checklists) apply the whole time — trialing or paid, Starter's feature set doesn't
// change. The only real cap left on Starter is its 3-agent-profile ceiling;
// transactions are unlimited on every plan. Accounts created before that
// cutoff are grandfathered onto the old free-forever Starter and never
// see the trial/paywall at all.

export type PlanId = 'starter' | 'pro' | 'team' | 'brokerage';

export const DEFAULT_PLAN: PlanId = 'starter';

export interface PlanLimits {
  /** Max transactions with a non-"Closed" status. null = unlimited. */
  maxActiveTransactions: number | null;
  /** Max agent profiles. null = unlimited. */
  maxAgents: number | null;
  /** Whether this plan gets access to the cross-account admin dashboard. */
  adminDashboard: boolean;
  /**
   * Whether this plan can build custom checklist templates (Settings ->
   * Checklist Templates). Every plan still gets the fixed baseline
   * checklist for free -- this only gates *authoring new templates*.
   */
  customChecklists: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  popular?: boolean;
  limits: PlanLimits;
  /**
   * True for a plan that still fully works (billing, feature limits,
   * Collaborate/team behavior -- everything in this file and
   * lib/team.ts) but is no longer offered to a new signup or shown as
   * an upgrade target. Brokerage is being pulled out into its own
   * product rather than killed outright, so existing Brokerage
   * customers must see zero change -- only PUBLIC_PLANS (what the
   * pricing page, onboarding's plan picker, and the account page's
   * "upgrade to" buttons iterate over) excludes it. Every lookup by id
   * (getPlan, getPlanLimits, planLabel, isTeamPlan, isValidPlan) still
   * reads the full PLANS array, so an existing Brokerage account's own
   * plan resolves exactly as before.
   */
  hidden?: boolean;
  /**
   * Starter-only: describes its free trial (30 days, or the user's first
   * paid-and-closed deal, whichever happens first -- see src/lib/trial.ts
   * for the actual enforcement logic). Undefined for Pro/Team, which have
   * no trial -- they're paid from checkout.
   */
  trial?: {
    days: number;
    description: string;
  };
  /**
   * Team and Brokerage only: per-seat billing details, read by
   * lib/team.ts (seat floor, Checkout quantity) and the frontend
   * (collaborate/account/pricing pages) instead of hardcoding a price
   * or seat count in copy. Undefined for Starter/Pro, which bill a
   * single flat seat.
   */
  seatInfo?: {
    pricePerSeat: number; // dollars/seat/month, for computing totals
    pricePerSeatLabel: string; // e.g. "$19/mo" -- for copy only
    minimumSeats: number;
  };
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$10',
    period: '/month',
    trial: {
      days: 30,
      description: 'Free for 30 days or until your first paid deal closes, whichever comes first.',
    },
    description: 'Free to try, then $10/month. Unlimited transactions.',
    features: [
      'Free for 30 days or your first paid deal',
      'Then $10/month',
      'Unlimited transactions',
      'Up to 3 agent profiles',
      'AI contract intake -- upload the contract, Relay fills in the deal',
      'Auto-built checklist with configurable per-step deadlines',
      'Document uploads per checklist step',
      'Manual invoicing',
    ],
    limits: {
      maxActiveTransactions: null,
      maxAgents: 3,
      adminDashboard: false,
      customChecklists: false,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29',
    period: '/month',
    description: 'For solo TCs running their transactions in Relay.',
    features: [
      'Unlimited transactions',
      'Unlimited agent profiles',
      'AI contract intake -- upload the contract, Relay fills in the deal',
      'Document uploads per checklist step',
      'Custom checklist templates with required-step flags',
      'Admin dashboard access',
      'Priority support',
    ],
    popular: true,
    limits: {
      maxActiveTransactions: null,
      maxAgents: null,
      adminDashboard: true,
      customChecklists: true,
    },
  },
  {
    id: 'team',
    name: 'Team',
    price: '$19',
    period: '/seat/mo',
    description: 'For teams sharing transactions, agents, and workflows. 3-seat minimum ($57/month).',
    features: [
      'Everything in Pro',
      'Shared agent roster across the team',
      'Team-wide transaction visibility',
      'Custom checklist templates with required-step flags',
      'Seat-based billing, 3-seat minimum',
      'Priority support',
    ],
    limits: {
      maxActiveTransactions: null,
      maxAgents: null,
      adminDashboard: true,
      customChecklists: true,
    },
    seatInfo: {
      pricePerSeat: 19,
      pricePerSeatLabel: '$19/mo',
      minimumSeats: 3,
    },
  },
  {
    id: 'brokerage',
    name: 'Brokerage',
    price: '$15',
    period: '/seat/mo',
    description: 'For a broker buying seats across a whole team. 10-seat minimum ($150/month).',
    features: [
      'Everything in Team',
      'Volume seat pricing for larger rosters',
      'Sized for a brokerage, not just one small team',
      'Seat-based billing, 10-seat minimum',
      'Priority support',
    ],
    limits: {
      maxActiveTransactions: null,
      maxAgents: null,
      adminDashboard: true,
      customChecklists: true,
    },
    seatInfo: {
      pricePerSeat: 15,
      pricePerSeatLabel: '$15/mo',
      minimumSeats: 10,
    },
    // Not a public offering right now -- see the `hidden` doc comment
    // above. Brokerage is being rebuilt as its own product rather than
    // a Relay plan tier; this entry stays so the one existing paying
    // Brokerage account keeps working exactly as it does today.
    hidden: true,
  },
];

/**
 * What a new signup, the onboarding plan picker, and the account
 * page's "upgrade to" buttons should actually offer -- PLANS minus
 * anything marked `hidden`. Launch surface is Starter/Pro/Team only
 * until the Brokerage spinoff ships.
 */
export const PUBLIC_PLANS: Plan[] = PLANS.filter((p) => !p.hidden);

// Team and Brokerage are the same underlying shared-workspace feature
// (src/lib/team.ts) -- they differ only in per-seat price and seat
// minimum (see each plan's seatInfo above). Checked wherever code used
// to special-case plan === 'team' alone, so a Brokerage owner/member
// gets identical team behavior under their own plan label.
export function isTeamPlan(planId: PlanId | string | null | undefined): boolean {
  return planId === 'team' || planId === 'brokerage';
}

export function isValidPlan(value: unknown): value is PlanId {
  return typeof value === 'string' && PLANS.some((p) => p.id === value);
}

export function getPlan(planId: string | null | undefined): Plan {
  return PLANS.find((p) => p.id === planId) || PLANS.find((p) => p.id === DEFAULT_PLAN)!;
}

export function planLabel(planId: string | null | undefined): string {
  return getPlan(planId).name;
}

export function getPlanLimits(planId: string | null | undefined): PlanLimits {
  return getPlan(planId).limits;
}
