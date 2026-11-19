import Stripe from 'stripe';
import { stripe } from './stripe';
import { getStripeCustomerByUserId, upsertStripeCustomer, setUserPlan } from './stripeCustomers';
import { supabaseServer } from './supabase';
import { getUserPlan, type WithAppMetadata } from './appMetadata';
import { isTeamPlan } from './plans';
import { ensureTeamForOwner } from './team';
import { getAccount, markSubscribed, markSubscriptionEnded } from './brokerageAccount';
import { brokeragePriceIds, type BrokerageBillingTier } from './stripePrices';
import { BROKERAGE_SUBSCRIPTION_KIND, accountStatusForSubscription, isBrokerageTier } from './brokerageBilling';

// The Stripe side of a brokerage subscription. Kept apart from stripeCustomers (which holds a person's own plan) so a brokerage
// subscription never changes anyone's personal plan.

const LIVE = ['active', 'trialing', 'past_due'];

export const isBrokerageSubscription = (sub: Stripe.Subscription): boolean => sub.metadata?.kind === BROKERAGE_SUBSCRIPTION_KIND;

/** The owner's live brokerage subscription, found by what we stamped on it at Checkout. Null when there is none. */
export async function findBrokerageSubscription(ownerId: string): Promise<{ subscription: Stripe.Subscription; tier: BrokerageBillingTier } | null> {
  const customer = await getStripeCustomerByUserId(ownerId);
  if (!customer || !customer.stripe_customer_id.startsWith('cus_')) return null;
  const list = await stripe.subscriptions.list({ customer: customer.stripe_customer_id, status: 'all', limit: 20 });
  const found = list.data.find((s) => isBrokerageSubscription(s) && s.metadata?.user_id === ownerId && LIVE.includes(s.status));
  if (!found) return null;
  const tier = found.metadata?.tier;
  return isBrokerageTier(tier) ? { subscription: found, tier } : null;
}

/**
 * Sets the per-agent item on the owner's subscription to `extraSeats`: adds it, changes its quantity, or removes it at zero.
 * Stripe prorates the change on the next invoice. Throws when there is no live subscription or the price is not configured.
 */
export async function setExtraAgentsOnSubscription(ownerId: string, extraSeats: number): Promise<void> {
  const found = await findBrokerageSubscription(ownerId);
  if (!found) throw new Error('No active brokerage subscription');
  const { subscription, tier } = found;
  const prices = brokeragePriceIds(tier);
  if (!prices.extraAgent) throw new Error('The extra-agent price is not configured');
  const item = subscription.items.data.find((i) => i.price.id === prices.extraAgent);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  if (extraSeats > 0 && item) items.push({ id: item.id, quantity: extraSeats });
  else if (extraSeats > 0) items.push({ price: prices.extraAgent, quantity: extraSeats });
  else if (item) items.push({ id: item.id, deleted: true });
  else return;
  await stripe.subscriptions.update(subscription.id, { items, proration_behavior: 'create_prorations' });
}

/**
 * checkout.session.completed for a brokerage subscription. Confirms with Stripe that the subscription is live (a late or repeated
 * event can never grant a plan nobody is paying for), then marks the account converted at the tier that was bought. The owner
 * must be on a Team plan to run a brokerage, so one is granted if they are not; their own personal subscription is never touched.
 */
export async function applyBrokerageCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const ownerId = session.client_reference_id || session.metadata?.user_id;
  const tier = session.metadata?.tier;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!ownerId || !isBrokerageTier(tier) || !customerId || !subscriptionId) {
    console.error('Brokerage checkout.session.completed is missing owner, tier, customer or subscription', { ownerId, tier, customerId, subscriptionId });
    return;
  }
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (accountStatusForSubscription(sub.status) !== 'converted') {
    console.warn(`Brokerage checkout ignored: subscription ${subscriptionId} is ${sub.status}`);
    return;
  }
  await upsertStripeCustomer({ user_id: ownerId, stripe_customer_id: customerId });
  const { data } = await supabaseServer.auth.admin.getUserById(ownerId);
  if (data.user && !isTeamPlan(getUserPlan(data.user as WithAppMetadata))) {
    await setUserPlan(ownerId, 'team');
    await ensureTeamForOwner(ownerId);
  }
  await markSubscribed(ownerId, tier);
}

/** customer.subscription.updated or .deleted for a brokerage subscription. Only an ended or unpaid subscription changes the account. */
export async function applyBrokerageSubscriptionEvent(sub: Stripe.Subscription): Promise<void> {
  const ownerId = sub.metadata?.user_id;
  if (!ownerId) return;
  if (accountStatusForSubscription(sub.status) !== 'terminated') return;
  // Subscribing again creates a new subscription; the old one ending afterwards must not pause the account.
  const live = await findBrokerageSubscription(ownerId);
  if (live && live.subscription.id !== sub.id) return;
  if (!(await getAccount(ownerId))) return;
  await markSubscriptionEnded(ownerId);
}
