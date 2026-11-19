import { NextRequest, NextResponse } from 'next/server';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { stripe, isBillablePlan } from '@/lib/stripe';
import { ensureStripeCustomerId } from '@/lib/stripeCustomerEnsure';
import { priceIdFor } from '@/lib/stripePrices';
import { isAgentUser } from '@/lib/agentPortal';
import { TEAM_SEAT_LIMIT, BROKERAGE_SEAT_LIMIT } from '@/lib/team';

// Starts a Stripe Checkout session for Starter (once its trial has ended),
// Pro, or Team — the three plans in STRIPE_PRICE_IDS. The user's plan is
// NOT changed here; that only happens once Stripe confirms payment via the
// webhook (checkout.session.completed), so someone can't grant themselves
// a paid plan (or reset their own trial) by calling this route without
// actually paying.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertNotCollaborator(user);

    const body = await request.json();
    const { plan } = body;

    if (!isBillablePlan(plan)) {
      return NextResponse.json({ error: 'plan must be one of: starter, pro, team, brokerage' }, { status: 400 });
    }

    // Agents and coordinators have separate prices (STRIPE_PRICE_AGENT_* and STRIPE_PRICE_TC_*); an unset agent price falls back
    // to the coordinator one, then to the original shared variable (see lib/stripePrices.ts).
    const priceId = priceIdFor(plan, isAgentUser(user) ? 'agent' : 'tc');
    if (!priceId) {
      console.error(`Missing Stripe price id for plan "${plan}" -- set the STRIPE_PRICE_* variables listed in lib/stripePrices.ts`);
      return NextResponse.json({ error: 'Billing is not configured for this plan yet' }, { status: 500 });
    }

    // Reuse this user's Stripe customer, or create one, so repeat checkouts and portal sessions share a single customer record.
    const customerId = await ensureStripeCustomerId(user);

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      // Team/Brokerage are quantity-based (per-seat); checkout starts at
      // that plan's seat-count floor. Starter/Pro are always quantity 1.
      line_items: [
        {
          price: priceId,
          quantity: plan === 'team' ? TEAM_SEAT_LIMIT : plan === 'brokerage' ? BROKERAGE_SEAT_LIMIT : 1,
        },
      ],
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
