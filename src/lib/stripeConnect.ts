import Stripe from 'stripe';
import { stripe } from './stripe';
import { supabaseServer } from './supabase';

/**
 * Stripe Connect (Standard accounts) -- lets a TC receive agent payments
 * directly into their own Stripe account, with Relay never touching
 * the funds. Built and verified against Stripe's own documented v1
 * Accounts + Account Links APIs (docs.stripe.com/connect), tested end to
 * end in Stripe's test mode -- unlike the still-unverified Helcim
 * integration in lib/helcim.ts, every call here is a confirmed, documented
 * endpoint.
 *
 * Deliberately uses the "classic" Standard account type (`stripe.accounts
 * .create({ type: 'standard' })`) rather than the newer Accounts v2 /
 * controller-properties model Stripe's docs now point new platforms
 * toward. v1 Standard accounts are still fully supported (Stripe's own
 * account-type comparison lists "SaaS platforms, such as an online
 * invoicing and payment service" as the canonical use case) and have
 * far more documented, verifiable API behavior -- v2 is real but sparser,
 * and this project already has one integration (Helcim) built on
 * guessed/unverified endpoints. Not repeating that here.
 *
 * No OAuth client_id/secret is needed at all: a Standard account can be
 * created directly via the Accounts API with just the platform's own
 * secret key, then onboarded via a Stripe-hosted Account Link. Once
 * connected, the platform never stores any credential belonging to the
 * TC's own Stripe account -- API calls that need to act as/for a
 * connected account (e.g. the direct-charge Checkout Session below) pass
 * its acct_... id as the `stripeAccount` request option, using the
 * platform's own secret key the whole time.
 */

export interface CreateConnectAccountParams {
  email?: string;
}

/** Creates a new Standard connected account. Returns its `acct_...` id. */
export async function createStandardConnectedAccount(
  params: CreateConnectAccountParams
): Promise<string> {
  const account = await stripe.accounts.create({
    type: 'standard',
    country: 'US',
    email: params.email,
  });
  return account.id;
}

export interface AccountLinkUrls {
  refreshUrl: string;
  returnUrl: string;
}

/**
 * Builds the single-use, short-lived (~a few minutes) hosted onboarding
 * URL a TC is sent to. `refreshUrl` is where Stripe sends them back if
 * this specific link has expired or was already used -- the caller is
 * expected to just hit the same start endpoint again to get a fresh one.
 */
export async function createOnboardingLink(
  accountId: string,
  urls: AccountLinkUrls
): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

export interface ConnectedAccountStatus {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/** Fetches a connected account's live status directly from Stripe -- the
 * source of truth used both right after onboarding (see
 * /api/stripe/connect/return) and whenever an account.updated webhook
 * arrives. */
export async function getConnectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
  const account = await stripe.accounts.retrieve(accountId);
  return {
    chargesEnabled: !!account.charges_enabled,
    detailsSubmitted: !!account.details_submitted,
  };
}

/** Maps Stripe's charges_enabled/details_submitted onto the same
 * pending/approved/declined vocabulary the (generic, provider-agnostic)
 * payment_accounts.status column already uses for Helcim. Stripe doesn't
 * have a hard "declined" concept for Standard accounts the way Helcim's
 * partner-approval flow does -- an account that never completes
 * onboarding just stays "pending" indefinitely, which is the right
 * default here. */
export function statusFromConnectedAccount(status: ConnectedAccountStatus): 'pending' | 'approved' {
  return status.chargesEnabled ? 'approved' : 'pending';
}

export interface CreateInvoiceCheckoutSessionParams {
  connectedAccountId: string;
  invoiceId: string;
  invoiceNumber: string;
  amountOwed: number; // dollars, e.g. 450.00
  successUrl: string;
  cancelUrl: string;
  /**
   * Relay's cut of this payment, in cents. Omitted/undefined today (0%
   * platform fee -- see lib/plans.ts and the decision not to take a
   * platform cut on these payments, at least for now). When that
   * changes, pass a cents amount here; Stripe deducts it from the TC's
   * charge and moves it straight into Relay's own balance.
   */
  applicationFeeAmount?: number;
}

/**
 * Creates a direct-charge Checkout Session for a single Relay invoice,
 * on the TC's own connected account (not Relay's) -- the agent (a guest
 * with no Relay account) pays on Stripe's hosted page, the charge is
 * created directly on the TC's Stripe account, and the money never
 * touches Relay's balance even momentarily. The TC is the merchant of
 * record for these payments, not Relay.
 *
 * `applicationFeeAmount` is Relay's optional cut of the payment -- see
 * its doc comment on CreateInvoiceCheckoutSessionParams above.
 *
 * `metadata.relay_invoice_id` is what the webhook uses to find its way
 * back to the right invoice row -- Checkout Sessions carry it through
 * onto the resulting PaymentIntent automatically. Because this charge is
 * created on the connected account, the resulting events arrive on the
 * Connect-scoped webhook (constructConnectWebhookEvent below), not the
 * platform's own subscription webhook.
 */
export async function createInvoiceCheckoutSession(
  params: CreateInvoiceCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
  const unitAmount = Math.round(params.amountOwed * 100);

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // Stripe SDK v23 replaced `payment_method_types` with this filter: Stripe
      // picks from the connected account's enabled payment methods, limited to
      // cards and US bank accounts (ACH) -- same options agents had before.
      allowed_payment_method_types: ['card', 'us_bank_account'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            product_data: {
              name: `Transaction coordination fee — ${params.invoiceNumber}`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        ...(params.applicationFeeAmount ? { application_fee_amount: params.applicationFeeAmount } : {}),
        metadata: { relay_invoice_id: params.invoiceId },
      },
      metadata: { relay_invoice_id: params.invoiceId },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
    { stripeAccount: params.connectedAccountId }
  );
}

/**
 * Whether this TC can currently be paid online through Relay -- the same
 * "approved payment_accounts row" check getInvoicePayUrlForDocument and
 * the Stripe pay-link route both already do, pulled out so agent-facing
 * surfaces (the invoices list, the per-transaction invoice card) can
 * decide up front whether to offer "Pay Now" at all, instead of letting
 * an agent click it and hit a 400 explaining the TC hasn't finished
 * Stripe onboarding -- that error is meant for the TC to see and act on
 * in their own Settings, not something an agent can do anything about.
 */
export async function isStripePayAvailable(tcUserId: string): Promise<boolean> {
  const { data: account } = await supabaseServer
    .from('payment_accounts')
    .select('status')
    .eq('tc_user_id', tcUserId)
    .eq('provider', 'stripe_connect')
    .maybeSingle();
  return !!account && account.status === 'approved';
}

/**
 * Looks up the invoice's TC Stripe Connect status and, if they're
 * approved, generates a fresh Checkout Session URL for embedding in a
 * downloaded/emailed invoice PDF. Returns null when the invoice is
 * already paid, the TC hasn't finished Stripe onboarding, or they've
 * chosen to handle payments manually -- callers should just omit the
 * "Pay Online" section of the PDF in that case rather than show a
 * broken link. A generation failure (e.g. Stripe briefly unreachable) is
 * also treated as null rather than failing the whole PDF/email.
 */
export async function getInvoicePayUrlForDocument(params: {
  invoice: { id: string; invoice_number: string; amount_owed: number; paid: boolean };
  tcUserId: string;
  origin: string;
}): Promise<string | null> {
  if (params.invoice.paid) return null;

  try {
    const { data: account } = await supabaseServer
      .from('payment_accounts')
      .select('status, connected_account_id')
      .eq('tc_user_id', params.tcUserId)
      .eq('provider', 'stripe_connect')
      .maybeSingle();

    if (!account || account.status !== 'approved') return null;

    // Don't hand out a fresh pay link while a payment for this invoice is
    // already received or still clearing (e.g. an ACH bank transfer).
    if ((await getInvoicePaymentState(account.connected_account_id, params.invoice.id)) !== 'none') return null;

    const session = await createInvoiceCheckoutSession({
      connectedAccountId: account.connected_account_id,
      invoiceId: params.invoice.id,
      invoiceNumber: params.invoice.invoice_number,
      amountOwed: params.invoice.amount_owed,
      successUrl: successUrlFor(params.origin, params.invoice.id),
      cancelUrl: `${params.origin}/pay/cancelled`,
    });
    return session.url;
  } catch (error) {
    console.error('Error creating Stripe pay link for PDF/email:', error);
    return null;
  }
}

/** Verifies a Connect-scoped webhook event's signature. This is a
 * SEPARATE webhook endpoint/secret from the platform's own subscription
 * webhook (see /api/stripe/webhook) -- Connect events on connected
 * accounts are a different event scope in Stripe (see
 * docs.stripe.com/connect/webhooks), registered with "Events from:
 * Connected accounts" and requiring `stripe listen --forward-connect-to`
 * (not --forward-to) for local testing. */
export function constructConnectWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET is not set');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}


/** Where Stripe sends the payer after Checkout. `{CHECKOUT_SESSION_ID}` is a
 * literal Stripe placeholder it replaces with the real session id, which
 * lets the success page confirm the payment with Stripe directly instead
 * of depending only on the webhook arriving first. */
export function successUrlFor(origin: string, invoiceId: string): string {
  return `${origin}/pay/success?invoice=${encodeURIComponent(invoiceId)}&session_id={CHECKOUT_SESSION_ID}`;
}

/**
 * Asks Stripe whether a payment for this invoice has already been received
 * ('paid') or is still clearing ('processing', e.g. an ACH bank transfer).
 * Used to stop a second payment link being created while one is in flight.
 * Fails open ('none') if Stripe's search is unavailable -- the invoice's
 * own `paid` flag is still the primary guard.
 */
export async function getInvoicePaymentState(
  connectedAccountId: string,
  invoiceId: string
): Promise<'paid' | 'processing' | 'none'> {
  try {
    const result = await stripe.paymentIntents.search(
      { query: `metadata['relay_invoice_id']:'${invoiceId.replace(/[^a-zA-Z0-9-]/g, '')}'`, limit: 20 },
      { stripeAccount: connectedAccountId }
    );
    if (result.data.some((pi) => pi.status === 'succeeded')) return 'paid';
    if (result.data.some((pi) => pi.status === 'processing')) return 'processing';
    return 'none';
  } catch (error) {
    console.error('Error checking Stripe for existing invoice payment:', error);
    return 'none';
  }
}

/**
 * Confirms an invoice payment straight from Stripe (the source of truth)
 * and marks the invoice paid. Called from the payment success page so the
 * invoice flips to paid right away even if the webhook is slow or not
 * running. Nothing in the URL is trusted: the invoice's connected account
 * comes from our own database, the Checkout Session is fetched from that
 * account, and its metadata must name this same invoice.
 */
export async function confirmInvoicePaymentFromSession(
  invoiceId: string,
  sessionId: string
): Promise<'paid' | 'processing' | 'unknown'> {
  try {
    const { data: invoice } = await supabaseServer
      .from('invoices')
      .select('id, agent_id, amount_owed, paid')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!invoice) return 'unknown';
    if (invoice.paid) return 'paid';

    const { data: agent } = await supabaseServer
      .from('agents')
      .select('tc_user_id')
      .eq('id', invoice.agent_id)
      .maybeSingle();
    if (!agent?.tc_user_id) return 'unknown';

    const { data: account } = await supabaseServer
      .from('payment_accounts')
      .select('connected_account_id')
      .eq('tc_user_id', agent.tc_user_id)
      .eq('provider', 'stripe_connect')
      .maybeSingle();
    if (!account) return 'unknown';

    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      {},
      { stripeAccount: account.connected_account_id }
    );
    if (session.metadata?.relay_invoice_id !== invoice.id) return 'unknown';
    if (session.payment_status === 'unpaid') return session.status === 'complete' ? 'processing' : 'unknown';

    const amountTotal = session.amount_total;
    if (typeof amountTotal !== 'number' || amountTotal / 100 < Number(invoice.amount_owed) - 0.01) return 'unknown';

    await supabaseServer
      .from('invoices')
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        paid_amount: amountTotal / 100,
      })
      .eq('id', invoice.id)
      .eq('paid', false);
    return 'paid';
  } catch (error) {
    console.error('Error confirming invoice payment with Stripe:', error);
    return 'unknown';
  }
}
