import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { isValidPlan, isTeamPlan, DEFAULT_PLAN } from '@/lib/plans';
import {
  getStripeCustomerByCustomerId,
  upsertStripeCustomer,
  setUserPlan,
} from '@/lib/stripeCustomers';
import { ensureTeamForOwner, dissolveTeamMembership } from '@/lib/team';

// Stripe calls this directly (no user session), authenticating itself via
// the signature header instead — so this route reads the RAW body rather
// than request.json(), since a re-serialized body would no longer match
// the signature. This is the only place a user's plan is ever upgraded,
// and the only place a cancelled subscription downgrades them back to
// Starter — every other route just reads whatever plan is on the account.
export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error('Stripe webhook called without a signature header or STRIPE_WEBHOOK_SECRET configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;

        const userId = session.client_reference_id || session.metadata?.user_id;
        const plan = session.metadata?.plan;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

        if (!userId || !isValidPlan(plan) || !customerId) {
          console.error('checkout.session.completed missing userId/plan/customerId', {
            userId,
            plan,
            customerId,
          });
          break;
        }

        // Stripe can deliver (or retry) this event late — e.g. after the
        // webhook was failing, or after the customer already cancelled. Only
        // grant the plan if the subscription is still live right now, so a
        // stale event can never give someone a plan they are no longer paying for.
        let liveStatus: string = 'active';
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            liveStatus = sub.status;
          } catch (err) {
            console.error('checkout.session.completed: could not verify subscription', subscriptionId, err);
            return NextResponse.json({ error: 'Could not verify subscription' }, { status: 500 });
          }
        }
        if (!['active', 'trialing', 'past_due'].includes(liveStatus)) {
          console.warn(`checkout.session.completed ignored: subscription ${subscriptionId} is ${liveStatus}`);
          break;
        }

        await upsertStripeCustomer({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId || null,
          plan,
          subscription_status: liveStatus,
        });
        await setUserPlan(userId, plan);

        // Team/Brokerage are a shared workspace — the person who just
        // paid becomes the team owner. Idempotent, so a repeat/duplicate
        // webhook event for the same user is harmless.
        if (isTeamPlan(plan)) {
          await ensureTeamForOwner(userId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

        const existing = await getStripeCustomerByCustomerId(customerId);
        if (!existing) {
          console.error(`customer.subscription.updated for unknown customer ${customerId}`);
          break;
        }

        const periodEnd = subscription.items.data[0]?.current_period_end;

        await upsertStripeCustomer({
          user_id: existing.user_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          plan: existing.plan,
        });

        // Stripe marks a subscription 'canceled' immediately if cancelled
        // without a grace period, or moves through 'past_due'/'unpaid' on
        // failed renewal payments. Treat any of those as no-longer-paying
        // and drop them back to Starter; 'active'/'trialing' keep their
        // plan as-is (no change needed here).
        if (['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)) {
          await setUserPlan(existing.user_id, DEFAULT_PLAN);
          await dissolveTeamMembership(existing.user_id, (memberId) => setUserPlan(memberId, DEFAULT_PLAN));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

        const existing = await getStripeCustomerByCustomerId(customerId);
        if (!existing) {
          console.error(`customer.subscription.deleted for unknown customer ${customerId}`);
          break;
        }

        await upsertStripeCustomer({
          user_id: existing.user_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: null,
          subscription_status: 'canceled',
          plan: DEFAULT_PLAN,
        });
        await setUserPlan(existing.user_id, DEFAULT_PLAN);
        await dissolveTeamMembership(existing.user_id, (memberId) => setUserPlan(memberId, DEFAULT_PLAN));
        break;
      }

      default:
        // Ignore everything else (invoice.*, payment_method.*, etc.) — not
        // needed for plan enforcement.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Error handling Stripe webhook event ${event.type}:`, error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
