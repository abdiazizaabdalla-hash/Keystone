import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { mergeUserMetadata } from '@/lib/userMetadata';
import { DEFAULT_PLAN } from '@/lib/plans';
import { getStripeCustomerByUserId } from '@/lib/stripeCustomers';
import { getTrialStatus } from '@/lib/trial';
import { needsOnboarding } from '@/lib/onboarding';
import { normalizeDueDateSpec } from '@/lib/dueDates';
import { BASELINE_CHECKLIST_TEMPLATE, normalizeTemplateSteps } from '@/lib/checklistTemplates';
import { TASK_TEMPLATE } from '@/lib/transactionStages';

const DEFAULT_FLAT_FEE = 400;
const DEFAULT_PERCENT_FEE = 0;
const DEFAULT_INVOICE_DUE_DAYS = 30;

function shapeUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> | null }) {
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email,
    is_admin: meta.is_admin || false,
    plan: meta.plan || DEFAULT_PLAN,
    fullName: typeof meta.full_name === 'string' ? meta.full_name : '',
    defaultFlatFee:
      typeof meta.default_flat_fee === 'number' ? meta.default_flat_fee : DEFAULT_FLAT_FEE,
    defaultPercentFee:
      typeof meta.default_percent_fee === 'number' ? meta.default_percent_fee : DEFAULT_PERCENT_FEE,
    invoiceDueDays:
      typeof meta.invoice_due_days === 'number' ? meta.invoice_due_days : DEFAULT_INVOICE_DUE_DAYS,
    // How this TC gets paid by agents: 'stripe' (Stripe Connect, see
    // /api/stripe/connect/*), 'manual' (Zelle/Venmo/PayPal/etc, handled
    // entirely outside Relay), or null if they haven't chosen yet
    // (prompted during onboarding, changeable later in Settings).
    paymentPreference:
      meta.payment_preference === 'stripe' || meta.payment_preference === 'manual'
        ? meta.payment_preference
        : null,
    // Whether new transactions get auto-calculated checklist due dates at
    // all -- opt-in, off by default: if a TC never sets this up (in
    // onboarding or Settings), the safe assumption is no due date preset
    // rather than one silently applied. Turning it on surfaces the
    // suggested per-step defaults below to edit or accept as-is.
    dueDateWorkflowEnabled: meta.due_date_workflow_enabled === true,
    // This TC's own due-date rule for each Baseline step, chosen during
    // onboarding or Settings rather than a single global default applying
    // to everyone. Falls back to the suggested defaults (see
    // BASELINE_CHECKLIST_TEMPLATE in lib/checklistTemplates.ts) until the
    // TC customizes it.
    dueDateWorkflowSteps: Array.isArray(meta.due_date_workflow_steps)
      ? normalizeTemplateSteps(meta.due_date_workflow_steps)
      : BASELINE_CHECKLIST_TEMPLATE.steps,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const shaped = shapeUser(user);

    // Lightweight trial info for the dashboard-wide banner (see
    // DashboardLayout) -- null whenever it doesn't apply: not on Starter,
    // grandfathered in, or already paying for Starter post-trial. Mirrors
    // the same "already paying" check assertTrialActive uses server-side,
    // and the fuller version account/summary exposes for the Account page.
    let trial = null;
    if (shaped.plan === 'starter') {
      const billing = await getStripeCustomerByUserId(user.id);
      const hasActivePaidStarter =
        billing?.plan === 'starter' &&
        !!billing.stripe_subscription_id &&
        ['active', 'trialing'].includes(billing.subscription_status || '');
      if (!hasActivePaidStarter) {
        const status = await getTrialStatus(user.id, user.created_at);
        trial = {
          applies: status.applies,
          trialEndsAt: status.trialEndsAt ? status.trialEndsAt.toISOString() : null,
          expired: status.expired,
          endedBy: status.endedBy,
          daysLeft:
            status.applies && status.trialEndsAt
              ? Math.max(0, Math.ceil((status.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
              : null,
        };
      }
    }

    // Whether DashboardLayout should bounce this sign-in to /onboarding
    // instead of rendering the dashboard -- see lib/onboarding.ts for why
    // this is safe to check on every account, not just new ones.
    const needsOnboardingFlow = await needsOnboarding(user.id, user.user_metadata);

    return NextResponse.json({ ...shaped, trial, needsOnboarding: needsOnboardingFlow });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error getting user:', error);
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
  }
}

// Lets a signed-in user update account-level preferences: their display
// name, default values used to pre-fill new agent forms, and their
// payment-method instructions shown on invoices they send.
//
// NOTE: `plan` is intentionally NOT editable here. Upgrading to Pro/Team
// now goes through Stripe Checkout (/api/stripe/checkout), and the plan is
// only ever granted once Stripe confirms payment via the webhook. Letting
// this route accept a `plan` field would let anyone grant themselves a
// paid plan for free by calling the API directly. Downgrading happens by
// cancelling in the Stripe billing portal (/api/stripe/portal), which
// drops them back to Starter via the same webhook.
//
// Just as important: this route only ever builds the *changes* the caller
// actually asked for, never a full metadata object built by spreading
// `user.user_metadata` from earlier in the request. That snapshot can
// already be stale by the time this handler runs -- most notably right
// after a Stripe Checkout, when the webhook is racing to write
// `plan: 'pro'` at the same moment the onboarding wizard is calling this
// route repeatedly for unrelated fields (full name, fee defaults, etc.).
// Building only the changed fields and merging them via
// mergeUserMetadata's fresh, right-before-the-write read (see
// lib/userMetadata.ts) is what stops one of those onboarding PATCHes from
// silently reverting a plan the customer just paid for. See that file for
// the full story -- this is the bug that caused exactly that.
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const body = await request.json();
    const {
      defaultFlatFee,
      defaultPercentFee,
      invoiceDueDays,
      fullName,
      paymentPreference,
      dueDateWorkflowEnabled,
      dueDateWorkflowSteps,
      onboardingCompleted,
    } = body;

    const changes: Record<string, unknown> = {};

    if (defaultFlatFee !== undefined) {
      const n = Number(defaultFlatFee);
      if (Number.isNaN(n) || n < 0) {
        return NextResponse.json({ error: 'defaultFlatFee must be a non-negative number' }, { status: 400 });
      }
      changes.default_flat_fee = n;
    }

    if (defaultPercentFee !== undefined) {
      const n = Number(defaultPercentFee);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: 'defaultPercentFee must be a number between 0 and 100' }, { status: 400 });
      }
      changes.default_percent_fee = n;
    }

    if (invoiceDueDays !== undefined) {
      const n = Number(invoiceDueDays);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return NextResponse.json({ error: 'invoiceDueDays must be a whole number of days between 1 and 365' }, { status: 400 });
      }
      changes.invoice_due_days = n;
    }

    if (fullName !== undefined) {
      if (typeof fullName !== 'string') {
        return NextResponse.json({ error: 'fullName must be a string' }, { status: 400 });
      }
      changes.full_name = fullName.trim();
    }

    if (paymentPreference !== undefined) {
      if (paymentPreference !== 'stripe' && paymentPreference !== 'manual') {
        return NextResponse.json({ error: "paymentPreference must be 'stripe' or 'manual'" }, { status: 400 });
      }
      changes.payment_preference = paymentPreference;
    }

    if (dueDateWorkflowEnabled !== undefined) {
      changes.due_date_workflow_enabled = Boolean(dueDateWorkflowEnabled);
    }

    if (dueDateWorkflowSteps !== undefined) {
      if (!Array.isArray(dueDateWorkflowSteps)) {
        return NextResponse.json({ error: 'dueDateWorkflowSteps must be an array' }, { status: 400 });
      }
      // Re-keyed by the canonical Baseline step names rather than trusted
      // as submitted, so a malformed or reordered payload can't smuggle in
      // an unexpected step or drop one silently.
      const byName = new Map(
        dueDateWorkflowSteps
          .filter((s): s is { name?: unknown; dueDate?: unknown } => !!s && typeof s === 'object')
          .map((s) => [String((s as { name?: unknown }).name), (s as { dueDate?: unknown }).dueDate])
      );
      changes.due_date_workflow_steps = TASK_TEMPLATE.map((name) => ({
        name,
        dueDate: normalizeDueDateSpec(byName.get(name)),
      }));
    }

    // Set by onboarding's final "Go to Dashboard" button, so DashboardLayout
    // never sends this account through the wizard again regardless of how
    // many agents it happens to have. See lib/onboarding.ts.
    if (onboardingCompleted !== undefined) {
      changes.onboarding_completed = Boolean(onboardingCompleted);
    }

    const updatedMetadata = await mergeUserMetadata(user.id, changes);

    return NextResponse.json(shapeUser({ id: user.id, email: user.email, user_metadata: updatedMetadata }));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating account settings:', error);
    return NextResponse.json({ error: 'Failed to update account settings' }, { status: 500 });
  }
}
