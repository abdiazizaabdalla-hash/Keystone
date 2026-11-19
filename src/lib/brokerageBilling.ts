import { BROKERAGE_PRICING } from './brokeragePricing';
import type { AccountStatus } from './brokeragePilot';
import type { BrokerageBillingTier } from './stripePrices';

// Pure rules for billing a brokerage through Stripe. No database and no Stripe calls here, so every rule can be tested.
//
// A brokerage subscription is one item on one graduated price per tier: a flat monthly fee for the first agents (the included
// ones), then a per-agent price for each agent after that. The quantity is the number of agents paid for, so it is the included
// number plus the extra agents the brokerage has bought. An owner with no extra agents is billed just the flat base.

export const BROKERAGE_SUBSCRIPTION_KIND = 'brokerage';

/** The subscription quantity for a tier with this many extra agents bought. */
export function brokerageQuantity(tier: BrokerageBillingTier, extraSeats: number): number {
  return BROKERAGE_PRICING[tier].includedAgents + Math.max(0, Math.floor(extraSeats));
}

/** The extra agents a subscription quantity stands for (never below zero). */
export function extraSeatsFromQuantity(tier: BrokerageBillingTier, quantity: number): number {
  return Math.max(0, Math.floor(quantity) - BROKERAGE_PRICING[tier].includedAgents);
}

/** The Checkout line items: the tier's graduated price at the quantity of agents paid for. */
export function brokerageLineItems(priceId: string, tier: BrokerageBillingTier, extraSeats: number): { price: string; quantity: number }[] {
  return [{ price: priceId, quantity: brokerageQuantity(tier, extraSeats) }];
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
