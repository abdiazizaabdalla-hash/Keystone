import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
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

      // The TC revoked Relay's access from their own Stripe Dashboard
      // (Settings -> Connected apps) -- Relay has no "Disconnect Stripe"
      // button of its own, so this is the only way that happens. Without
      // this handler, payment_accounts.status would stay 'approved'
      // forever and Settings would keep showing Stripe as connected, even
      // though generating a pay link would now fail against an account
      // that no longer grants Relay access. Reuses the existing 'declined'
      // status rather than adding a new enum value -- every pay-link call
      // site already treats anything other than 'approved' as "can't pay
      // online right now" and falls back safely (a null link, never a
      // broken one). Added 2026-09.
      case 'account.application.deauthorized': {
        if (!event.account) break;

        await supabaseServer
          .from('payment_accounts')
          .update({ status: 'declined', updated_at: new Date().toISOString() })
          .eq('connected_account_id', event.account)
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

      // An agent's payment was refunded -- the TC does this from their own
      // Stripe dashboard (Relay has no refund button of its own). Without
      // this, an invoice stayed `paid = true` forever with no record the
      // money came back, silently overstating "Revenue Collected" on both
      // the TC's dashboard and the admin panel. Added 2026-09.
      //
      // A Charge created under a PaymentIntent inherits that PaymentIntent's
      // metadata, so relay_invoice_id is normally right on the Charge --
      // but fall back to retrieving the PaymentIntent itself (scoped to
      // the connected account via event.account) if it's ever missing, so
      // a metadata-copy quirk on Stripe's side can't silently drop a
      // refund. `amount_refunded` is the charge's cumulative refunded
      // total (not just this event's refund), so a partial-then-full
      // refund sequence always ends up with the correct final amount
      // rather than double-counting.
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        let invoiceId = charge.metadata?.relay_invoice_id;

        if (!invoiceId && typeof charge.payment_intent === 'string' && event.account) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              charge.payment_intent,
              {},
              { stripeAccount: event.account }
            );
            invoiceId = paymentIntent.metadata?.relay_invoice_id;
          } catch (piError) {
            console.error('Error retrieving PaymentIntent for charge.refunded fallback lookup:', piError);
          }
        }

        if (!invoiceId) break;

        const { error: refundError } = await supabaseServer
          .from('invoices')
          .update({
            refunded: charge.amount_refunded > 0,
            refunded_at: charge.amount_refunded > 0 ? new Date().toISOString() : null,
            refunded_amount: charge.amount_refunded > 0 ? charge.amount_refunded / 100 : null,
          })
          .eq('id', invoiceId);

        if (refundError) {
          console.error(`Error marking invoice ${invoiceId} refunded from Stripe Connect webhook:`, refundError);
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
