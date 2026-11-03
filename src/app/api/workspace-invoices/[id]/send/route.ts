import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';
import { logAudit } from '@/lib/audit';
import { generateWorkspaceInvoicePdf } from '@/lib/workspaceInvoicePdf';
import { assertInvoiceSender, invoiceTotals, loadOwnInvoice } from '@/lib/workspaceInvoices';

// POST: email the invoice (with the PDF attached) to its bill-to address and mark it sent. Replies go to the agent.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    assertInvoiceSender(user);
    await assertTrialActive(user);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1500) : '';
    const { invoice, lines } = await loadOwnInvoice(id, user.id);

    if (invoice.status === 'void' || invoice.status === 'paid') {
      return NextResponse.json({ error: 'A paid or voided invoice cannot be sent.' }, { status: 400 });
    }
    if (!invoice.bill_to_email) {
      return NextResponse.json({ error: 'Add an email address for who this is billed to first.' }, { status: 400 });
    }
    if (lines.length === 0 || invoiceTotals(lines, invoice.tax_percent).total <= 0) {
      return NextResponse.json({ error: 'Add at least one line with an amount first.' }, { status: 400 });
    }

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

    const total = invoiceTotals(lines, invoice.tax_percent).total;
    const html = `<p>Hi ${escapeHtml(invoice.bill_to_name || 'there')},</p>
      <p>${escapeHtml(fromName)} sent you invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> for <strong>$${total.toFixed(2)}</strong>${invoice.due_date ? `, due ${escapeHtml(invoice.due_date)}` : ''}. The PDF is attached.</p>
      ${message ? `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
      <p style="font-size:12px;color:#777">Sent through Relay TC. Reply to this email to reach ${escapeHtml(fromName)}.</p>`;

    const resend = getResendClient();
    const result = await resend.emails.send({
      from: INVOICE_FROM_EMAIL,
      to: invoice.bill_to_email,
      replyTo: user.email || undefined,
      subject: `Invoice ${invoice.invoice_number} from ${fromName}`,
      html,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: pdf }],
    });
    if (result.error) {
      console.error('Invoice email failed:', result.error);
      return NextResponse.json({ error: 'The email could not be sent. Try again in a moment.' }, { status: 502 });
    }

    const { error } = await supabaseServer
      .from('workspace_invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await logAudit(request, user, 'workspace_invoice.send', { entityType: 'workspace_invoice', entityId: id });
    return NextResponse.json({ status: 'sent', sentTo: invoice.bill_to_email });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error sending workspace invoice:', error);
    return NextResponse.json({ error: 'Failed to send invoice' }, { status: 500 });
  }
}
