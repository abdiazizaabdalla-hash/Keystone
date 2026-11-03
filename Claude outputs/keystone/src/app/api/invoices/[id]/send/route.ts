import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { generateInvoicePdf } from '@/lib/invoicePdf';
import { loadInvoiceBundle, loadZellePaymentInfo } from '@/lib/invoiceData';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';

const BUCKET = 'transaction-documents';
// Keep the direct email attachment well under typical provider limits
// (Resend caps a request around 40MB); above this we upload a zip to
// Storage instead and link to it from the email body.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ZIP_LINK_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function uniqueFileName(name: string, seen: Map<string, number>) {
  const count = seen.get(name) || 0;
  seen.set(name, count + 1);
  if (count === 0) return name;
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return `${name} (${count})`;
  return `${name.slice(0, dotIndex)} (${count})${name.slice(dotIndex)}`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    const { invoice, agent, transaction } = await loadInvoiceBundle(id, user.id, isAdmin);

    if (!agent || !transaction) {
      return NextResponse.json({ error: 'Invoice is missing agent or transaction data' }, { status: 500 });
    }

    if (!agent.email) {
      return NextResponse.json(
        { error: 'This agent has no email address on file. Add one on the Agents page first.' },
        { status: 400 }
      );
    }

    // Gather every completed/uploaded document for the transaction.
    const { data: docs, error: docsError } = await supabaseServer
      .from('documents')
      .select('*')
      .eq('transaction_id', transaction.id)
      .order('created_at', { ascending: true });

    if (docsError) throw docsError;
    const documentRows = docs || [];

    const zelle = await loadZellePaymentInfo(agent);
    const pdfBuffer = await generateInvoicePdf(invoice, agent, transaction, zelle, invoice.helcim_pay_url);

    // Build a zip of every document so far uploaded for this transaction.
    const zip = new JSZip();
    const seenNames = new Map<string, number>();
    const failedDocs: string[] = [];

    for (const doc of documentRows) {
      const { data: fileBlob, error: downloadError } = await supabaseServer.storage
        .from(BUCKET)
        .download(doc.storage_path);

      if (downloadError || !fileBlob) {
        failedDocs.push(doc.file_name);
        continue;
      }

      const arrayBuffer = await fileBlob.arrayBuffer();
      zip.file(uniqueFileName(doc.file_name, seenNames), Buffer.from(arrayBuffer));
    }

    const hasDocuments = documentRows.length > failedDocs.length;
    const zipBuffer = hasDocuments
      ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      : null;

    const totalAttachmentBytes = pdfBuffer.length + (zipBuffer?.length || 0);
    const attachments: { filename: string; content: Buffer }[] = [
      { filename: `${invoice.invoice_number}.pdf`, content: pdfBuffer },
    ];

    let zipDownloadUrl: string | null = null;

    if (zipBuffer) {
      if (totalAttachmentBytes <= MAX_ATTACHMENT_BYTES) {
        attachments.push({ filename: `${invoice.invoice_number}-documents.zip`, content: zipBuffer });
      } else {
        const zipPath = `invoice-exports/${invoice.id}-${Date.now()}.zip`;
        const { error: uploadError } = await supabaseServer.storage
          .from(BUCKET)
          .upload(zipPath, zipBuffer, { contentType: 'application/zip', upsert: true });

        if (uploadError) throw uploadError;

        const { data: signed } = await supabaseServer.storage
          .from(BUCKET)
          .createSignedUrl(zipPath, ZIP_LINK_TTL_SECONDS);
        zipDownloadUrl = signed?.signedUrl || null;
      }
    }

    const money = (n: number) =>
      `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const html = `
      <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${agent.name.split(' ')[0] || agent.name},</p>
        <p>${message ? message.replace(/\n/g, '<br/>') : `Attached is your invoice for ${transaction.property_address}, along with the completed transaction documents.`}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 6px 0; color: #666;">Invoice</td><td style="padding: 6px 0; text-align: right;">${invoice.invoice_number}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Property</td><td style="padding: 6px 0; text-align: right;">${transaction.property_address}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">File #</td><td style="padding: 6px 0; text-align: right;">${transaction.file_number}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Due Date</td><td style="padding: 6px 0; text-align: right;">${new Date(invoice.due_date).toLocaleDateString()}</td></tr>
          <tr><td style="padding: 10px 0; color: #1a1a1a; font-weight: bold; border-top: 1px solid #ddd;">Total Due</td><td style="padding: 10px 0; text-align: right; font-weight: bold; border-top: 1px solid #ddd;">${money(invoice.amount_owed)}</td></tr>
        </table>
        <p>The invoice PDF is attached${zipBuffer && !zipDownloadUrl ? ', along with a zip of every document uploaded for this transaction.' : '.'}</p>
        ${zipDownloadUrl ? `<p>The document set was too large to attach directly — you can download it here (link expires in 7 days): <a href="${zipDownloadUrl}">${zipDownloadUrl}</a></p>` : ''}
        ${!hasDocuments ? '<p>No documents have been uploaded for this transaction yet.</p>' : ''}
        ${failedDocs.length ? `<p style="color: #b45309;">Note: ${failedDocs.length} file(s) could not be attached (${failedDocs.join(', ')}).</p>` : ''}
        ${zelle && !invoice.paid ? `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #faf6ec; border: 1px solid #e8dcb8; border-radius: 8px;">
          <tr>
            <td style="padding: 16px;">
              <p style="margin: 0 0 4px; font-size: 12px; font-weight: bold; color: #8a6d1f; letter-spacing: 0.04em;">PAY WITH ZELLE</p>
              <p style="margin: 0 0 2px; font-weight: bold; color: #1a1a1a;">${zelle.displayName || 'Relay TC'}</p>
              <p style="margin: 0 0 8px; color: #333;">${zelle.contact}</p>
              <img src="${zelle.qrDataUrl}" width="120" height="120" alt="Zelle QR code" style="display: block; margin-bottom: 8px;" />
              <p style="margin: 0; font-size: 12px; color: #777;">Scan with your banking app, or send Zelle to the contact above.</p>
            </td>
          </tr>
        </table>
        ` : ''}
        <p>Thanks,<br/>Relay TC</p>
      </div>
    `;

    const resend = getResendClient();
    const { error: sendError } = await resend.emails.send({
      from: INVOICE_FROM_EMAIL,
      to: agent.email,
      subject: `Invoice ${invoice.invoice_number} — ${transaction.property_address}`,
      html,
      attachments,
    });

    if (sendError) {
      console.error('Resend error:', sendError);
      return NextResponse.json({ error: sendError.message || 'Failed to send email' }, { status: 502 });
    }

    const sentAt = new Date().toISOString();
    const { data: updatedInvoice, error: updateError } = await supabaseServer
      .from('invoices')
      .update({ sent_at: sentAt, sent_to: agent.email })
      .eq('id', invoice.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      ...updatedInvoice,
      agent,
      transaction,
      documentsIncluded: documentRows.length - failedDocs.length,
      documentsFailed: failedDocs,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.includes('RESEND_API_KEY')) {
      return NextResponse.json(
        { error: 'Email sending is not set up yet. Add RESEND_API_KEY to your environment.' },
        { status: 501 }
      );
    }
    console.error('Error sending invoice email:', error);
    return NextResponse.json({ error: 'Failed to send invoice email' }, { status: 500 });
  }
}
