import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { generateInvoicePdf } from '@/lib/invoicePdf';
import { loadInvoiceBundle, loadTcInfo } from '@/lib/invoiceData';
import { getInvoicePayUrlForDocument } from '@/lib/stripeConnect';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id } = await params;

    const { invoice, agent, transaction } = await loadInvoiceBundle(id, user.id, isAdmin);

    if (!agent || !transaction) {
      return NextResponse.json({ error: 'Invoice is missing agent or transaction data' }, { status: 500 });
    }

    const tc = await loadTcInfo(agent.tc_user_id);
    const origin = new URL(request.url).origin;
    const payUrl = await getInvoicePayUrlForDocument({ invoice, tcUserId: agent.tc_user_id, origin });
    const pdfBuffer = await generateInvoicePdf(invoice, agent, transaction, tc, payUrl);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.invoice_number}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error generating invoice PDF:', error);
    return NextResponse.json({ error: 'Failed to generate invoice PDF' }, { status: 500 });
  }
}
