import { DEFAULT_PLAN } from './plans';
import { getStripeCustomerByUserId } from './stripeCustomers';
import { getUserPlan } from './privileged';

// Starter used to be free forever. It's now a 30-day
// trial, after which the account needs to add
// payment ($19/month, via the same Stripe Checkout flow as Pro/Team — see
// lib/stripe.ts) to keep creating or editing anything.
//
// This cutoff is what makes that change non-retroactive: only accounts
// created on or after it are ever subject to the trial/paywall at all.
// Every Starter account that existed before this shipped keeps the old
// free-forever behavior, permanently — see getTrialStatus below.
export const TRIAL_ENFORCEMENT_START = new Date('2026-09-23T00:00:00Z');

export const TRIAL_DAYS = 30;

// Parses a timestamp as UTC. Strings with no timezone designator (e.g.
// TIMESTAMP WITHOUT TIME ZONE columns, serialized like
// "2026-09-23T05:06:43.285") would otherwise be read in this process's local
// timezone; append 'Z' when nothing's already there. Supabase Auth's
// user.created_at already carries an offset, so this is a no-op for it.
function parseUtc(value: string): Date {
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasOffset ? value : `${value}Z`);
}

export interface TrialStatus {
  /** false = this account is grandfathered in; never enforced, ignore the rest. */
  applies: boolean;
  trialEndsAt: Date | null;
  expired: boolean;
  /** What ends the trial: the 30-day clock. Null when the trial doesn't apply. */
  endedBy: 'time' | null;
}

/**
 * Computes where a Starter account stands relative to its trial. Doesn't
 * care what plan the account is actually on — callers check that first
 * (see assertTrialActive below) since Pro/Team and an already-paying
 * Starter account never need this at all.
 *
 * The trial is a flat 30 days from account creation, regardless of any
 * transaction or invoice activity.
 */
export async function getTrialStatus(userId: string, userCreatedAt: string): Promise<TrialStatus> {
  const createdAt = parseUtc(userCreatedAt);

  if (createdAt < TRIAL_ENFORCEMENT_START) {
    return { applies: false, trialEndsAt: null, expired: false, endedBy: null };
  }

  const timeLimit = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  return {
    applies: true,
    trialEndsAt: timeLimit,
    expired: Date.now() >= timeLimit.getTime(),
    endedBy: 'time',
  };
}

export class TrialExpiredError extends Error {
  status = 402;
  trialEndsAt: string | null;
  endedBy: 'time' | null;

  constructor(message: string, trialEndsAt: Date | null, endedBy: 'time' | null) {
    super(message);
    this.name = 'TrialExpiredError';
    this.trialEndsAt = trialEndsAt ? trialEndsAt.toISOString() : null;
    this.endedBy = endedBy;
  }
}

type MinimalUser = {
  id: string;
  created_at: string;
  app_metadata?: Record<string, unknown> | null;
};

/**
 * Called at the top of every mutating route that creates or edits work
 * (transactions, agents, tasks, documents, invoices). No-ops for anyone
 * not on Starter, and for a Starter account that's already paying for it
 * post-trial (tracked in stripe_customers exactly like Pro/Team — see
 * stripe/webhook/route.ts, which upserts that row on
 * checkout.session.completed regardless of which of the three plans was
 * purchased). Throws TrialExpiredError (handle it like AuthError — catch
 * it and return its .status) once the trial's actually over.
 */
export async function assertTrialActive(user: MinimalUser): Promise<void> {
  const planId = (getUserPlan(user) as string | undefined) || DEFAULT_PLAN;
  if (planId !== 'starter') return;

  const billing = await getStripeCustomerByUserId(user.id);
  const hasActivePaidStarter =
    billing?.plan === 'starter' &&
    !!billing.stripe_subscription_id &&
    ['active', 'trialing'].includes(billing.subscription_status || '');
  if (hasActivePaidStarter) return;

  const status = await getTrialStatus(user.id, user.created_at);
  if (status.applies && status.expired) {
    throw new TrialExpiredError(
      'Your free Starter trial has ended. Add payment ($19/month) to keep creating and editing on Relay.',
      status.trialEndsAt,
      status.endedBy
    );
  }
}
