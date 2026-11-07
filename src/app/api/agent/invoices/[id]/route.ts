import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { loadInvoiceBundle, loadTcInfo } from '@/lib/invoiceData';
import { isStripePayAvailable } from '@/lib/stripeConnect';

// GET: one invoice a coordinator made for this agent, with what the agent needs to understand and pay it: who billed it, the deal,
// how the amount was worked out (the same lines as on the PDF), and where it stands. For an agent on the deal or its owner.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    const { id } = await params;
    const { invoice, agent, transaction } = await loadInvoiceBundle(id, user.id, false, { allowAgent: true, isAgent: true });
    if (!agent || !transaction) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    // An agent's own record of someone is never an invoice to them.
    if (agent.tc_user_id === user.id) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const [tc, payOnline, { data: tx }] = await Promise.all([
      loadTcInfo(agent.tc_user_id),
      isStripePayAvailable(agent.tc_user_id),
      supabaseServer.from('transactions').select('closing_date, status').eq('id', transaction.id).maybeSingle(),
    ]);

    const price = Number(transaction.purchase_price) || 0;
    const flatFee = Number(agent.flat_fee) || 0;
    const percent = Number(agent.commission_percent) || 0;
    const percentAmount = (price * percent) / 100;

    return NextResponse.json({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amountOwed: Number(invoice.amount_owed),
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      sentAt: invoice.sent_at ?? null,
      paid: !!invoice.paid,
      paidAt: invoice.paid_at ?? null,
      paidAmount: invoice.paid_amount ?? null,
      refunded: !!invoice.refunded,
      refundedAmount: invoice.refunded_amount ?? null,
      payOnline,
      billedBy: { name: tc.name, email: tc.email },
      deal: {
        id: transaction.id,
        fileNumber: transaction.file_number,
        propertyAddress: transaction.property_address,
        purchasePrice: price,
        closingDate: tx?.closing_date ?? null,
        status: tx?.status ?? null,
      },
      fee: { flatFee, percent, percentAmount, total: flatFee + percentAmount },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading the invoice for the agent:', error);
    return NextResponse.json({ error: 'Failed to load the invoice' }, { status: 500 });
  }
}
