import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { loadInvoiceBundle } from '@/lib/invoiceData';
import { createInvoiceCheckoutSession, getInvoicePaymentState, successUrlFor } from '@/lib/stripeConnect';
import { isAgentUser } from '@/lib/agentPortal';

// Creates a fresh Stripe Checkout payment link for an invoice. Unlike the
// Helcim pay-link route, this does NOT persist the URL on the invoice --
// a Checkout Session (mode: 'payment') is only valid for 24 hours, so
// treating it as a permanent link the way Helcim's hosted invoice works
// would go stale. The TC just generates a new one whenever they need to
// send/re-send it; the invoice's own `paid` status (set by the Connect
// webhook via metadata.relay_invoice_id) is what actually matters.
//
// Also reachable by the invited agent on this invoice's own transaction
// (see loadInvoiceBundle's allowAgent option) -- lets them pay straight
// from their own portal instead of only through a link the TC sends.
// The webhook that marks the invoice paid is keyed off the Checkout
// Session's metadata, not who generated the link, so this needs no
// changes on that end.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id } = await params;

    const { invoice, agent } = await loadInvoiceBundle(id, user.id, isAdmin, {
      allowAgent: true,
      isAgent: isAgentUser(user),
    });
    if (!agent) {
      return NextResponse.json({ error: 'Invoice is missing agent data' }, { status: 500 });
    }

    if (invoice.paid) {
      return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 400 });
    }

    const { data: account } = await supabaseServer
      .from('payment_accounts')
      .select('status, connected_account_id')
      .eq('tc_user_id', agent.tc_user_id)
      .eq('provider', 'stripe_connect')
      .maybeSingle();

    if (!account || account.status !== 'approved') {
      return NextResponse.json(
        { error: 'Connect and finish onboarding with Stripe in Settings before generating payment links.' },
        { status: 400 }
      );
    }

    // Block a second payment: Stripe already has a succeeded payment for this
    // invoice (webhook not yet processed) or a bank transfer still clearing.
    const paymentState = await getInvoicePaymentState(account.connected_account_id, invoice.id);
    if (paymentState === 'paid') {
      await supabaseServer
        .from('invoices')
        .update({ paid: true, paid_at: new Date().toISOString(), paid_amount: invoice.amount_owed })
        .eq('id', invoice.id)
        .eq('paid', false);
      return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 400 });
    }
    if (paymentState === 'processing') {
      return NextResponse.json(
        { error: 'A payment for this invoice is already processing. It will be marked paid once it clears.' },
        { status: 409 }
      );
    }

    const origin = new URL(request.url).origin;
    const session = await createInvoiceCheckoutSession({
      connectedAccountId: account.connected_account_id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amountOwed: invoice.amount_owed,
      successUrl: successUrlFor(origin, invoice.id),
      cancelUrl: `${origin}/pay/cancelled`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return NextResponse.json({ payUrl: session.url });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to create Stripe payment link';
    console.error('Error creating Stripe payment link:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
