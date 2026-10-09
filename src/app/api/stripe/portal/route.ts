import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { getStripeCustomerByUserId } from '@/lib/stripeCustomers';

// Opens Stripe's hosted billing portal for the signed-in user, so they can
// update their card, view invoices, or cancel — cancellation flows back
// through the webhook (customer.subscription.deleted) to downgrade them to
// Starter, rather than any code here touching their plan directly.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const existing = await getStripeCustomerByUserId(user.id);
    if (!existing) {
      return NextResponse.json(
        { error: 'No billing account found for this user yet. Upgrade to Pro or Team first.' },
        { status: 400 }
      );
    }

    const origin = new URL(request.url).origin;

    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: existing.stripe_customer_id,
        return_url: `${origin}/dashboard/account`,
      });
    } catch (err) {
      // Stale customer id (e.g. created under test keys): nothing to manage yet.
      if ((err as { code?: string } | null)?.code === 'resource_missing') {
        return NextResponse.json(
          { error: 'No billing account found for this user yet. Upgrade to Pro or Team first.' },
          { status: 400 }
        );
      }
      throw err;
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating billing portal session:', error);
    return NextResponse.json({ error: 'Failed to open billing portal' }, { status: 500 });
  }
}
