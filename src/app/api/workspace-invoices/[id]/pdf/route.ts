import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { generateWorkspaceInvoicePdf } from '@/lib/workspaceInvoicePdf';
import { assertWorkspaceAgent, loadOwnInvoice } from '@/lib/workspaceInvoices';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    const { id } = await params;
    const { invoice, lines } = await loadOwnInvoice(id, user.id);
    const meta = user.user_metadata || {};
    const fromName = typeof meta.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim() : user.email || 'Agent';
    const pdf = await generateWorkspaceInvoicePdf({
      invoiceNumber: invoice.invoice_number,
      title: invoice.title,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      status: invoice.status,
      memo: invoice.memo,
      taxPercent: Number(invoice.tax_percent),
      billTo: { name: invoice.bill_to_name, email: invoice.bill_to_email, address: invoice.bill_to_address },
      from: { name: fromName, email: user.email ?? null },
      lines,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${invoice.invoice_number}.pdf"` },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error building invoice PDF:', error);
    return NextResponse.json({ error: 'Failed to build the PDF' }, { status: 500 });
  }
}
