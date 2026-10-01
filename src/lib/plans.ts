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

export type PlanId = 'starter' | 'pro' | 'team';

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
   * Starter-only: describes its free trial (30 days, or the user's first
   * paid-and-closed deal, whichever happens first -- see src/lib/trial.ts
   * for the actual enforcement logic). Undefined for Pro/Team, which have
   * no trial -- they're paid from checkout.
   */
  trial?: {
    days: number;
    description: string;
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
      'Auto-built checklist per deal',
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
    description: 'For solo TCs running every deal through Relay.',
    features: [
      'Unlimited transactions',
      'Unlimited agent profiles',
      'Document uploads per checklist step',
      'Custom checklist templates',
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
    description: 'For a shared workflow. 3-seat minimum ($57/month).',
    features: [
      'Everything in Pro',
      'Shared agent roster across the team',
      'Team-wide transaction visibility',
      'Custom checklist templates',
      'Seat-based billing, 3-seat minimum',
      'Priority support',
    ],
    limits: {
      maxActiveTransactions: null,
      maxAgents: null,
      adminDashboard: true,
      customChecklists: true,
    },
  },
];

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
