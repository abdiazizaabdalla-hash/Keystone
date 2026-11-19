import { stripe } from './stripe';
import { getStripeCustomerByUserId, upsertStripeCustomer } from './stripeCustomers';

/**
 * The Stripe customer for this user: reuse the stored one, or create it. A stored id can be stale (created under test keys, or
 * deleted in Stripe); Stripe then answers "resource_missing" and a fresh customer is made so checkout never fails for that reason.
 */
export async function ensureStripeCustomerId(user: { id: string; email?: string | null }): Promise<string> {
  const existing = await getStripeCustomerByUserId(user.id);
  let reusable: string | null = null;
  if (existing && existing.stripe_customer_id.startsWith('cus_')) {
    try {
      const found = await stripe.customers.retrieve(existing.stripe_customer_id);
      if (!('deleted' in found && found.deleted)) reusable = existing.stripe_customer_id;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== 'resource_missing') throw err;
    }
  } else if (existing) {
    // Non-Stripe placeholder id (e.g. an admin bypass row): keep old behavior.
    reusable = existing.stripe_customer_id;
  }
  if (reusable) return reusable;
  const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } });
  await upsertStripeCustomer({ user_id: user.id, stripe_customer_id: customer.id });
  return customer.id;
}
