import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { stripe } from '@/lib/stripe';
import { ensureStripeCustomerId } from '@/lib/stripeCustomerEnsure';
import { brokerageOn, assertBrokerageOwner } from '@/lib/oversight';
import { getAccount } from '@/lib/brokerageAccount';
import { brokeragePriceIds } from '@/lib/stripePrices';
import { BROKERAGE_SUBSCRIPTION_KIND, brokerageLineItems, isBrokerageTier } from '@/lib/brokerageBilling';
import { findBrokerageSubscription } from '@/lib/brokerageStripe';

// POST { tier: 'basic' | 'pro' }: starts Stripe Checkout for a brokerage subscription (the tier's monthly base, plus the per-agent
// price for any extra agents already bought). Nothing about the account changes here: it becomes Brokerage / Brokerage Pro only
// when Stripe confirms payment through the webhook, so calling this route without paying grants nothing.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertNotCollaborator(user);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    await assertBrokerageOwner(user);

    const body = (await request.json().catch(() => ({}))) as { tier?: unknown };
    if (!isBrokerageTier(body.tier)) return NextResponse.json({ error: 'Choose Brokerage or Brokerage Pro.' }, { status: 400 });
    const tier = body.tier;

    const prices = brokeragePriceIds(tier);
    if (!prices.base || !prices.extraAgent) {
      console.error(`Brokerage billing is not configured for "${tier}" -- set STRIPE_PRICE_BROKERAGE_${tier.toUpperCase()} and STRIPE_PRICE_BROKERAGE_${tier.toUpperCase()}_EXTRA_AGENT`);
      return NextResponse.json({ error: 'Online billing is not switched on for this plan yet. Use "Request upgrade" and we will set it up with you.' }, { status: 503 });
    }

    if (await findBrokerageSubscription(user.id)) {
      return NextResponse.json({ error: 'This brokerage already has an active subscription. Use Manage billing to change it.' }, { status: 409 });
    }

    const account = await getAccount(user.id);
    const customerId = await ensureStripeCustomerId(user);
    const origin = new URL(request.url).origin;
    const metadata = { user_id: user.id, kind: BROKERAGE_SUBSCRIPTION_KIND, tier };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: brokerageLineItems({ base: prices.base, extraAgent: prices.extraAgent }, account?.extra_seats ?? 0),
      subscription_data: { metadata },
      metadata,
      success_url: `${origin}/dashboard/collaborate?billing=success`,
      cancel_url: `${origin}/dashboard/collaborate?billing=cancelled`,
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error creating brokerage checkout session:', error);
    return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 });
  }
}
