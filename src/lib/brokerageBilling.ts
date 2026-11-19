import { BROKERAGE_PRICING } from './brokeragePricing';
import type { AccountStatus } from './brokeragePilot';
import type { BrokerageBillingTier } from './stripePrices';

// Pure rules for billing a brokerage through Stripe. No database and no Stripe calls here, so every rule can be tested.
//
// A brokerage subscription has one required item (the tier's monthly base, which includes the first agents) and an optional
// second item: the per-agent price, with the quantity set to the number of EXTRA agents the brokerage has bought.

export const BROKERAGE_SUBSCRIPTION_KIND = 'brokerage';

/** The Checkout line items: the base, plus the extra-agent price only when at least one extra agent is already bought. */
export function brokerageLineItems(prices: { base: string; extraAgent: string }, extraSeats: number): { price: string; quantity: number }[] {
  const items = [{ price: prices.base, quantity: 1 }];
  const extra = Math.max(0, Math.floor(extraSeats));
  if (extra > 0) items.push({ price: prices.extraAgent, quantity: extra });
  return items;
}

/** The fewest extra seats a brokerage can have without going under the agents it already has (joined plus invited). */
export function minimumExtraSeats(tier: BrokerageBillingTier, counts: { active: number; pending: number }): number {
  return Math.max(0, counts.active + counts.pending - BROKERAGE_PRICING[tier].includedAgents);
}

/** Checks a requested number of extra seats. Returns an error message, or null when it is fine. */
export function validateExtraSeats(tier: BrokerageBillingTier, requested: unknown, counts: { active: number; pending: number }): string | null {
  if (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 0) return 'Enter a whole number of extra agents, zero or more.';
  if (requested > 500) return 'For more than 500 extra agents, contact Relay.';
  const floor = minimumExtraSeats(tier, counts);
  if (requested < floor) return `You already have ${counts.active + counts.pending} agents, counting invitations, so you need at least ${floor} extra. Remove an agent or cancel an invitation first.`;
  return null;
}

/** What a Stripe subscription status means for the brokerage account. Null means leave the account as it is. */
export function accountStatusForSubscription(stripeStatus: string): AccountStatus | null {
  if (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due') return 'converted';
  if (stripeStatus === 'canceled' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete_expired') return 'terminated';
  return null;
}

export const isBrokerageTier = (v: unknown): v is BrokerageBillingTier => v === 'basic' || v === 'pro';
