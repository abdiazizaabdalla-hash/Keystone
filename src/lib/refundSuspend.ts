import { stripe } from './stripe';
import { DEFAULT_PLAN } from './plans';
import { getStripeCustomerByCustomerId, upsertStripeCustomer, setUserPlan } from './stripeCustomers';
import { dissolveTeamMembership } from './team';
import { supabaseServer } from './supabase';
import { isPlatformAdmin } from './privileged';
import { logAudit } from './audit';

// Same indefinite-suspension value the admin Suspend button uses
// (see /api/admin/users/[id]); cleared with ban_duration: 'none'.
const INDEFINITE_BAN = '876000h';

/**
 * A subscription payment was fully refunded: this person is no longer a
 * paying customer. Stop any live subscription, drop them to Starter, and
 * suspend sign-in until an admin reactivates them. Never suspends a
 * platform admin. Safe to run more than once for the same customer.
 *
 * Returns false when the Stripe customer isn't one of ours.
 */
export async function applyFullRefund(customerId: string, reference: string): Promise<boolean> {
  const existing = await getStripeCustomerByCustomerId(customerId);
  if (!existing) {
    console.error(`Full refund for unknown customer ${customerId}`);
    return false;
  }

  // Stop any live subscription so it can't renew (and charge again).
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  for (const sub of subs.data) {
    if (['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
      await stripe.subscriptions.cancel(sub.id);
    }
  }

  await upsertStripeCustomer({
    user_id: existing.user_id,
    stripe_customer_id: customerId,
    stripe_subscription_id: null,
    subscription_status: 'refunded',
    plan: DEFAULT_PLAN,
  });
  await setUserPlan(existing.user_id, DEFAULT_PLAN);
  await dissolveTeamMembership(existing.user_id, (memberId) => setUserPlan(memberId, DEFAULT_PLAN));

  const { data: target } = await supabaseServer.auth.admin.getUserById(existing.user_id);
  if (target?.user && !isPlatformAdmin(target.user)) {
    const { error: banError } = await supabaseServer.auth.admin.updateUserById(existing.user_id, {
      ban_duration: INDEFINITE_BAN,
    });
    if (banError) throw banError;
    await logAudit(null, null, 'billing.refund_suspend_user', {
      entityType: 'user',
      entityId: existing.user_id,
      metadata: { reference },
    });
  } else {
    console.warn(`Full refund: ${existing.user_id} is a platform admin or missing; not suspended`);
  }
  return true;
}

/** True when this customer's most recent successful charge was refunded in full. */
export async function latestChargeFullyRefunded(customerId: string): Promise<string | null> {
  const charges = await stripe.charges.list({ customer: customerId, limit: 5 });
  const latest = charges.data.find((c) => c.status === 'succeeded');
  return latest && latest.refunded ? latest.id : null;
}
