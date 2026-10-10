import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { cleanWebhookSecret, describeSecretShape } from '@/lib/webhookSecret';
import { isValidPlan, isTeamPlan, DEFAULT_PLAN } from '@/lib/plans';
import {
  getStripeCustomerByCustomerId,
  upsertStripeCustomer,
  setUserPlan,
} from '@/lib/stripeCustomers';
import { ensureTeamForOwner, dissolveTeamMembership } from '@/lib/team';
import { supabaseServer } from '@/lib/supabase';
import { isPlatformAdmin } from '@/lib/privileged';
import { logAudit } from '@/lib/audit';

// Same indefinite-suspension value the admin Suspend button uses
// (see /api/admin/users/[id]); cleared with ban_duration: 'none'.
const INDEFINITE_BAN = '876000h';

// Stripe calls this directly (no user session), authenticating itself via
// the signature header instead — so this route reads the RAW body rather
// than request.json(), since a re-serialized body would no longer match
// the signature. This is the only place a user's plan is ever upgraded,
// and the only place a cancelled subscription downgrades them back to
// Starter — every other route just reads whatever plan is on the account.
export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = cleanWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET);

  if (!signature || !webhookSecret) {
    console.error('Stripe webhook called without a signature header or STRIPE_WEBHOOK_SECRET configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(
      'Stripe webhook signature verification failed:',
      err instanceof Error ? err.message : err,
      'secret shape:',
      describeSecretShape(process.env.STRIPE_WEBHOOK_SECRET)
    );
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

      case 'charge.refunded': {
        // A subscription payment was refunded in Stripe. Everything charged
        // on the platform account is a Relay subscription (agent invoice
        // payments live on connected accounts and use the Connect webhook),
        // so a FULL refund means "this person is no longer a paying
        // customer": stop the subscription, drop them to Starter, and
        // suspend sign-in until an admin reactivates them. Partial refunds
        // (goodwill credits) leave the account alone.
        const charge = event.data.object as Stripe.Charge;
        const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
        if (!customerId) break;

        if (!charge.refunded) {
          console.warn(`charge.refunded: partial refund on ${charge.id}; account left active`);
          break;
        }

        const existing = await getStripeCustomerByCustomerId(customerId);
        if (!existing) {
          console.error(`charge.refunded for unknown customer ${customerId}`);
          break;
        }

        // Stop any live subscription so it can't renew (and charge again).
        try {
          const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
          for (const sub of subs.data) {
            if (['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
              await stripe.subscriptions.cancel(sub.id);
            }
          }
        } catch (err) {
          console.error('charge.refunded: could not cancel subscription(s) for', customerId, err);
          return NextResponse.json({ error: 'Could not cancel subscription' }, { status: 500 });
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

        // Suspend sign-in, but never lock out a platform admin by accident.
        const { data: target } = await supabaseServer.auth.admin.getUserById(existing.user_id);
        if (target?.user && !isPlatformAdmin(target.user)) {
          const { error: banError } = await supabaseServer.auth.admin.updateUserById(existing.user_id, {
            ban_duration: INDEFINITE_BAN,
          });
          if (banError) throw banError;
          await logAudit(null, null, 'billing.refund_suspend_user', {
            entityType: 'user',
            entityId: existing.user_id,
            metadata: { chargeId: charge.id },
          });
        } else {
          console.warn(`charge.refunded: ${existing.user_id} is a platform admin or missing; not suspended`);
        }
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
