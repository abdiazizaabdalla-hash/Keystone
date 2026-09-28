import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { stripe, STRIPE_PRICE_IDS, isBillablePlan } from '@/lib/stripe';
import { getStripeCustomerByUserId, upsertStripeCustomer } from '@/lib/stripeCustomers';
import { TEAM_SEAT_LIMIT } from '@/lib/team';

// Starts a Stripe Checkout session for Starter (once its trial has ended),
// Pro, or Team — the three plans in STRIPE_PRICE_IDS. The user's plan is
// NOT changed here; that only happens once Stripe confirms payment via the
// webhook (checkout.session.completed), so someone can't grant themselves
// a paid plan (or reset their own trial) by calling this route without
// actually paying.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const body = await request.json();
    const { plan } = body;

    if (!isBillablePlan(plan)) {
      return NextResponse.json({ error: 'plan must be one of: starter, pro, team' }, { status: 400 });
    }

    const priceId = STRIPE_PRICE_IDS[plan];
    if (!priceId) {
      console.error(`Missing Stripe price id for plan "${plan}" — check STRIPE_PRICE_STARTER/STRIPE_PRICE_PRO/STRIPE_PRICE_TEAM env vars`);
      return NextResponse.json({ error: 'Billing is not configured for this plan yet' }, { status: 500 });
    }

    // Reuse an existing Stripe customer for this user if we have one,
    // otherwise create one now so repeat checkouts/portal sessions share
    // a single customer record instead of creating duplicates.
    let customerId: string;
    const existing = await getStripeCustomerByUserId(user.id);
    if (existing) {
      customerId = existing.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await upsertStripeCustomer({ user_id: user.id, stripe_customer_id: customerId });
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      // Team's price is $19/seat (quantity-based); checkout starts at
      // the 3-seat minimum. Starter/Pro are always quantity 1.
      line_items: [{ price: priceId, quantity: plan === 'team' ? TEAM_SEAT_LIMIT : 1 }],
      subscription_data: {
        metadata: { user_id: user.id, plan },
      },
      metadata: { user_id: user.id, plan },
      success_url: `${origin}/onboarding?plan=${plan}&checkout=success`,
      cancel_url: `${origin}/onboarding?plan=${plan}&checkout=cancelled`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
  }
}
