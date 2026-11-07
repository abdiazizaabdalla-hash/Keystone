import { loadLogo } from '@/lib/brandLogo';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { generateWorkspaceInvoicePdf } from '@/lib/workspaceInvoicePdf';
import { invoiceTotals, loadInvoiceForViewer } from '@/lib/workspaceInvoices';
import { workspaceInvoicePayUrlForDocument } from '@/lib/stripeConnect';

// The PDF of an agent's invoice: for the agent who sent it, and for the person it was sent to (their coordinator).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    const { id } = await params;
    const { invoice, lines } = await loadInvoiceForViewer(id, user);
    const { data: ownerData } = await supabaseServer.auth.admin.getUserById(invoice.owner_user_id as string);
    const owner = ownerData.user;
    const meta = owner?.user_metadata || {};
    const fromName = typeof meta.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim() : owner?.email || 'Agent';
    const total = invoiceTotals(lines, Number(invoice.tax_percent)).total;
    const payUrl = await workspaceInvoicePayUrlForDocument(
      { id: invoice.id as string, invoice_number: invoice.invoice_number as string, owner_user_id: invoice.owner_user_id as string, status: invoice.status as string, total },
      new URL(request.url).origin
    );
    const pdf = await generateWorkspaceInvoicePdf({
      invoiceNumber: invoice.invoice_number,
      title: invoice.title,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      status: invoice.status,
      memo: invoice.memo,
      taxPercent: Number(invoice.tax_percent),
      billTo: { name: invoice.bill_to_name, email: invoice.bill_to_email, address: invoice.bill_to_address },
      from: { name: fromName, email: owner?.email ?? null },
      lines,
      payUrl,
    }, await loadLogo(invoice.owner_user_id as string));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${invoice.invoice_number}.pdf"` },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error building invoice PDF:', error);
    return NextResponse.json({ error: 'Failed to build the PDF' }, { status: 500 });
  }
}
