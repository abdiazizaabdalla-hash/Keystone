import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { generateInvoicePdf } from '@/lib/invoicePdf';
import { loadInvoiceBundle, loadTcInfo } from '@/lib/invoiceData';
import { getInvoicePayUrlForDocument } from '@/lib/stripeConnect';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { formatDisplayDate } from '@/lib/dueDates';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';

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
    await assertTrialActive(user);
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
    const allDocumentRows = docs || [];

    // For anything signed through Relay's own e-signature flow, the
    // agent should get the signed copy, not the original that was sent
    // out for signature -- both rows stick around in the Documents list
    // (the original stays visible there for its own audit trail), but
    // only the signed copy belongs in this email. Skip this filtering
    // for documents that were simply marked "Signed" by hand (no
    // signing_requests row) or never sent through Relay's e-signature at
    // all -- there's only ever one file for those, so nothing to drop.
    const { data: completedSigningRequests, error: signingRequestsError } = await supabaseServer
      .from('signing_requests')
      .select('document_id')
      .eq('transaction_id', transaction.id)
      .eq('status', 'signed')
      .not('document_id', 'is', null);

    if (signingRequestsError) throw signingRequestsError;

    const supersededOriginalIds = new Set(
      (completedSigningRequests || []).map((r) => r.document_id as string)
    );

    const documentRows = allDocumentRows.filter((doc) => !supersededOriginalIds.has(doc.id));

    const tc = await loadTcInfo(agent.tc_user_id);
    const origin = new URL(request.url).origin;
    const payUrl = await getInvoicePayUrlForDocument({ invoice, tcUserId: agent.tc_user_id, origin });
    const pdfBuffer = await generateInvoicePdf(invoice, agent, transaction, tc, payUrl);

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
          <tr><td style="padding: 6px 0; color: #666;">Due Date</td><td style="padding: 6px 0; text-align: right;">${formatDisplayDate(invoice.due_date)}</td></tr>
          <tr><td style="padding: 10px 0; color: #1a1a1a; font-weight: bold; border-top: 1px solid #ddd;">Total Due</td><td style="padding: 10px 0; text-align: right; font-weight: bold; border-top: 1px solid #ddd;">${money(invoice.amount_owed)}</td></tr>
        </table>
        <p>The invoice PDF is attached${zipBuffer && !zipDownloadUrl ? ', along with a zip of every document uploaded for this transaction.' : '.'}</p>
        ${zipDownloadUrl ? `<p>The document set was too large to attach directly — you can download it here (link expires in 7 days): <a href="${zipDownloadUrl}">${zipDownloadUrl}</a></p>` : ''}
        ${!hasDocuments ? '<p>No documents have been uploaded for this transaction yet.</p>' : ''}
        ${failedDocs.length ? `<p style="color: #b45309;">Note: ${failedDocs.length} file(s) could not be attached (${failedDocs.join(', ')}).</p>` : ''}
        <p>Thanks,<br/>${tc.name}</p>
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
      // Resend's send errors are almost always something the caller can
      // fix (bad/placeholder recipient domain, missing field, rate
      // limit) rather than an actual upstream outage, so this is a 400,
      // not a 502 -- the frontend already surfaces sendError.message
      // directly to the TC, and a 502 misleadingly reads as "try again
      // later" for what's really a validation problem.
      return NextResponse.json({ error: sendError.message || 'Failed to send email' }, { status: 400 });
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
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
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
