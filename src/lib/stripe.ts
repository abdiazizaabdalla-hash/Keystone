import Stripe from 'stripe';

// Server-side Stripe client. Behaves identically against a sk_test_...
// or sk_live_... STRIPE_SECRET_KEY (see .env.local) -- which mode this
// runs in is purely that one env var, nothing in code.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Stripe Price IDs for the paid plans, created once in the Stripe dashboard
// (or via the setup script) and referenced here by env var so they can
// differ between test and live mode without a code change.
//
// Team is billed as a flat $57/mo price (the 3-seat minimum bundled into
// one price) rather than a $19 x quantity-3 price — there's no real seat
// management yet (see lib/plans.ts), so per-seat quantity would be more
// complexity than the product currently supports. Revisit when the real
// multi-seat model ships.
//
// Starter joined the paid plans once its 30-day/first-paid-deal free
// trial shipped (see lib/trial.ts) — STRIPE_PRICE_STARTER is its $10/mo
// price. A trialing user never hits this: checkout for 'starter' is only
// ever started once their trial has actually expired (see the "Add
// payment" flow on /dashboard/account and the dashboard trial banner).
export const STRIPE_PRICE_IDS: Record<'starter' | 'pro' | 'team' | 'brokerage', string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
  team: process.env.STRIPE_PRICE_TEAM!,
  // Brokerage reuses Team's per-seat-quantity Checkout shape (see
  // api/stripe/checkout/route.ts) with its own, cheaper per-unit price
  // -- a volume discount for a broker buying seats across a whole team
  // rather than one small 3-person workspace.
  brokerage: process.env.STRIPE_PRICE_BROKERAGE!,
};

export type BillablePlan = keyof typeof STRIPE_PRICE_IDS;

export function isBillablePlan(value: unknown): value is BillablePlan {
  return value === 'starter' || value === 'pro' || value === 'team' || value === 'brokerage';
}
