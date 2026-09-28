import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseServer } from '@/lib/supabase';
import { constructConnectWebhookEvent, statusFromConnectedAccount } from '@/lib/stripeConnect';

// Receives Connect-scoped webhook events -- a SEPARATE scope from the
// platform's own subscription webhook (/api/stripe/webhook). Locally this
// is reached via `stripe listen --forward-connect-to`, not `--forward-to`;
// in production it's a second webhook endpoint in the Dashboard with
// "Events from" set to "Connected accounts" (see docs.stripe.com/connect
// /webhooks). Every event here carries a top-level `account` field naming
// which connected account triggered it.
export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = constructConnectWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error('Stripe Connect webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      // Keeps payment_accounts.status in sync going forward -- e.g. a TC
      // who finishes onboarding later, or whose account picks up a new
      // requirement after already being approved.
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const status = statusFromConnectedAccount({
          chargesEnabled: !!account.charges_enabled,
          detailsSubmitted: !!account.details_submitted,
        });

        await supabaseServer
          .from('payment_accounts')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('connected_account_id', account.id)
          .eq('provider', 'stripe_connect');
        break;
      }

      // An agent paid an invoice through a generated Stripe payment link.
      // metadata.relay_invoice_id was set when the Checkout Session
      // was created (see lib/stripeConnect.ts) and carries through onto
      // this event either way, so this handles both a Checkout-level and
      // a PaymentIntent-level event without needing both.
      case 'checkout.session.completed':
      case 'payment_intent.succeeded': {
        const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
        const invoiceId = object.metadata?.relay_invoice_id;
        if (!invoiceId) break;

        const amountTotal =
          'amount_total' in object && typeof object.amount_total === 'number'
            ? object.amount_total
            : 'amount' in object
            ? object.amount
            : null;

        const { error } = await supabaseServer
          .from('invoices')
          .update({
            paid: true,
            paid_at: new Date().toISOString(),
            paid_amount: amountTotal !== null ? amountTotal / 100 : null,
          })
          .eq('id', invoiceId)
          .eq('paid', false); // idempotent -- a repeat event for an already-paid invoice no-ops

        if (error) {
          console.error(`Error marking invoice ${invoiceId} paid from Stripe Connect webhook:`, error);
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Error handling Stripe Connect webhook event ${event.type}:`, error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
