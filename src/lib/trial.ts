import { supabaseServer } from './supabase';
import { DEFAULT_PLAN } from './plans';
import { getStripeCustomerByUserId } from './stripeCustomers';

// Starter used to be free forever. It's now a 30-day-or-first-paid-deal
// trial (whichever comes first), after which the account needs to add
// payment ($10/month, via the same Stripe Checkout flow as Pro/Team — see
// lib/stripe.ts) to keep creating or editing anything.
//
// This cutoff is what makes that change non-retroactive: only accounts
// created on or after it are ever subject to the trial/paywall at all.
// Every Starter account that existed before this shipped keeps the old
// free-forever behavior, permanently — see getTrialStatus below.
export const TRIAL_ENFORCEMENT_START = new Date('2026-09-23T00:00:00Z');

export const TRIAL_DAYS = 30;

// invoices.paid_at (like several other legacy columns -- see created_at
// throughout invoices/tasks/agents) is a TIMESTAMP WITHOUT TIME ZONE
// column, so Postgres/PostgREST serializes it with no offset, e.g.
// "2026-09-23T05:06:43.285" instead of "...285Z". `new Date(...)` on a
// string with no timezone designator parses it in *this process's local
// timezone*, not UTC -- which silently shifts it by however many hours
// this server's local offset is from UTC (Supabase's Postgres sessions
// run in UTC, so the naive string is really a UTC wall-clock reading).
// Force UTC interpretation by appending 'Z' when nothing's already there.
// Supabase Auth's user.created_at is TIMESTAMPTZ and always arrives with
// an offset already, so this is a no-op for it -- safe to run on both.
function parseUtc(value: string): Date {
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasOffset ? value : `${value}Z`);
}

export interface TrialStatus {
  /** false = this account is grandfathered in; never enforced, ignore the rest. */
  applies: boolean;
  trialEndsAt: Date | null;
  expired: boolean;
  /** Which condition determines trialEndsAt — whichever comes soonest. */
  endedBy: 'time' | 'first_paid_deal' | null;
}

/**
 * Computes where a Starter account stands relative to its trial. Doesn't
 * care what plan the account is actually on — callers check that first
 * (see assertTrialActive below) since Pro/Team and an already-paying
 * Starter account never need this at all.
 *
 * "First paid deal" is deliberately based on an *invoice actually being
 * marked paid*, not on the transaction merely reaching "Closed" status.
 * Someone stalling a deal at "Clear to Close" forever to dodge the
 * early-trigger doesn't get anything for it — the 30-day clock runs
 * regardless of transaction/invoice state, so there's no way to stay on
 * Starter past 30 days without paying either way.
 */
export async function getTrialStatus(userId: string, userCreatedAt: string): Promise<TrialStatus> {
  const createdAt = parseUtc(userCreatedAt);

  if (createdAt < TRIAL_ENFORCEMENT_START) {
    return { applies: false, trialEndsAt: null, expired: false, endedBy: null };
  }

  const timeLimit = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const { data: agents, error: agentsError } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('tc_user_id', userId);
  if (agentsError) throw agentsError;

  const agentIds = (agents || []).map((a) => a.id);

  let firstPaidAt: Date | null = null;
  if (agentIds.length > 0) {
    const { data: paidInvoice, error: invoiceError } = await supabaseServer
      .from('invoices')
      .select('paid_at')
      .in('agent_id', agentIds)
      .eq('paid', true)
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (paidInvoice?.paid_at) firstPaidAt = parseUtc(paidInvoice.paid_at);
  }

  let trialEndsAt = timeLimit;
  let endedBy: 'time' | 'first_paid_deal' = 'time';
  if (firstPaidAt && firstPaidAt.getTime() < trialEndsAt.getTime()) {
    trialEndsAt = firstPaidAt;
    endedBy = 'first_paid_deal';
  }

  return {
    applies: true,
    trialEndsAt,
    expired: Date.now() >= trialEndsAt.getTime(),
    endedBy,
  };
}

export class TrialExpiredError extends Error {
  status = 402;
  trialEndsAt: string | null;
  endedBy: 'time' | 'first_paid_deal' | null;

  constructor(message: string, trialEndsAt: Date | null, endedBy: 'time' | 'first_paid_deal' | null) {
    super(message);
    this.name = 'TrialExpiredError';
    this.trialEndsAt = trialEndsAt ? trialEndsAt.toISOString() : null;
    this.endedBy = endedBy;
  }
}

type MinimalUser = {
  id: string;
  created_at: string;
  user_metadata?: Record<string, unknown> | null;
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
  const planId = (user.user_metadata?.plan as string | undefined) || DEFAULT_PLAN;
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
      'Your free Starter trial has ended. Add payment ($10/month) to keep creating and editing on Relay.',
      status.trialEndsAt,
      status.endedBy
    );
  }
}
