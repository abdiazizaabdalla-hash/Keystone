import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { generateInvoicePdf } from '@/lib/invoicePdf';
import { loadInvoiceBundle, loadZellePaymentInfo } from '@/lib/invoiceData';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id } = await params;

    const { invoice, agent, transaction } = await loadInvoiceBundle(id, user.id, isAdmin);

    if (!agent || !transaction) {
      return NextResponse.json({ error: 'Invoice is missing agent or transaction data' }, { status: 500 });
    }

    const zelle = await loadZellePaymentInfo(agent);
    const pdfBuffer = await generateInvoicePdf(invoice, agent, transaction, zelle, invoice.helcim_pay_url);

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
