import { confirmInvoicePaymentFromSession } from '@/lib/stripeConnect';

export const dynamic = 'force-dynamic';

export default async function PaySuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ invoice?: string; session_id?: string }>;
}) {
  const { invoice, session_id: sessionId } = await searchParams;

  // Confirm with Stripe directly so the invoice is marked paid immediately,
  // even if the webhook is delayed. 'unknown' (no params, or Stripe couldn't
  // confirm yet) falls back to the generic message -- the webhook still
  // handles it.
  const state = invoice && sessionId ? await confirmInvoicePaymentFromSession(invoice, sessionId) : 'unknown';
  const processing = state === 'processing';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 mx-auto mb-6 rounded-full bg-green-500/10 border border-green-500/40 flex items-center justify-center">
          <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-display font-semibold text-slate-100 mb-2">
          {processing ? 'Payment processing' : 'Payment received'}
        </h1>
        <p className="text-slate-400">
          {processing
            ? 'Your bank transfer was submitted and is still clearing, which can take a few business days. The invoice will be marked paid automatically once it does. You can close this page.'
            : 'Thanks — your payment went through and the transaction coordinator has been notified. You can close this page.'}
        </p>
      </div>
    </div>
  );
}
