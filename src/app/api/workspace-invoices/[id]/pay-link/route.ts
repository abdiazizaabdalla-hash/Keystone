import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { invoiceTotals, loadInvoiceForViewer } from '@/lib/workspaceInvoices';
import { createWorkspaceInvoicePayUrl } from '@/lib/stripeConnect';

// POST: a fresh Stripe payment page for an agent's invoice, paid into the agent's own connected Stripe account. Available to the
// agent who sent it and to the person it was sent to. Checkout Sessions last 24 hours, so a new one is made each time.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    const { id } = await params;
    const { invoice, lines } = await loadInvoiceForViewer(id, user);
    const made = await createWorkspaceInvoicePayUrl(
      {
        id: invoice.id as string,
        invoice_number: invoice.invoice_number as string,
        owner_user_id: invoice.owner_user_id as string,
        status: invoice.status as string,
        total: invoiceTotals(lines, Number(invoice.tax_percent)).total,
      },
      new URL(request.url).origin
    );
    if ('error' in made) return NextResponse.json({ error: made.error }, { status: made.status });
    return NextResponse.json({ payUrl: made.payUrl });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error creating a payment link for an agent invoice:', error);
    return NextResponse.json({ error: 'Failed to create the payment link' }, { status: 500 });
  }
}
