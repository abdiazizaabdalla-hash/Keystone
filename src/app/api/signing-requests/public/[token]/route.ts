import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { stampSignatureCertificate } from '@/lib/signing';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';

const BUCKET = 'transaction-documents';
const PREVIEW_URL_TTL_SECONDS = 60 * 30; // 30 minutes -- plenty for one signing session

// GET /api/signing-requests/public/[token] -- PUBLIC, no auth. The token
// itself IS the auth (see lib/signing.ts) -- deliberately returns only
// what the signer's page needs (file name, a scoped preview link, and
// status), never anything else about the transaction.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: signingRequest, error } = await supabaseServer
    .from('signing_requests')
    .select('status, signer_name, source_file_name, source_storage_path, signed_at, expires_at, decline_reason')
    .eq('token', token)
    .single();

  if (error || !signingRequest) {
    return NextResponse.json({ error: 'This signing link is invalid or has expired' }, { status: 404 });
  }

  // A pending request past its expires_at reads as expired even though
  // its DB status is still 'pending' -- there's no cron flipping it, this
  // is checked live on every access. Kept separate from 'voided' so a TC
  // can tell "nobody ever opened it" apart from "I cancelled it myself"
  // if they go looking. Added 2026-09 -- signing links previously never
  // expired at all.
  const isExpired =
    signingRequest.status === 'pending' &&
    !!signingRequest.expires_at &&
    new Date(signingRequest.expires_at) < new Date();

  if (isExpired) {
    return NextResponse.json({ error: 'This signing link is invalid or has expired' }, { status: 404 });
  }

  if (signingRequest.status !== 'pending') {
    return NextResponse.json({
      status: signingRequest.status,
      fileName: signingRequest.source_file_name,
      signerName: signingRequest.signer_name,
      signedAt: signingRequest.signed_at,
      declineReason: signingRequest.status === 'declined' ? signingRequest.decline_reason : undefined,
    });
  }

  const { data: signed } = await supabaseServer.storage
    .from(BUCKET)
    .createSignedUrl(signingRequest.source_storage_path, PREVIEW_URL_TTL_SECONDS);

  return NextResponse.json({
    status: 'pending',
    fileName: signingRequest.source_file_name,
    signerName: signingRequest.signer_name,
    previewUrl: signed?.signedUrl || null,
  });
}

// Best-effort real client IP from standard proxy headers (Vercel sets
// x-forwarded-for). Just for the audit trail -- never used for any
// access-control decision, so a missing/spoofable value is a non-issue.
function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

// POST /api/signing-requests/public/[token] -- PUBLIC, no auth. Submits
// the signer's signature: stamps a Signature Certificate page onto the
// original PDF (lib/signing.ts), stores the result, records the audit
// trail, and adds the signed PDF to the transaction's Documents list.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { signatureType, signatureValue, consent, decline, reason } = body;

    const { data: signingRequest, error: fetchError } = await supabaseServer
      .from('signing_requests')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !signingRequest) {
      return NextResponse.json({ error: 'This signing link is invalid or has expired' }, { status: 404 });
    }

    const isExpired =
      signingRequest.status === 'pending' &&
      !!signingRequest.expires_at &&
      new Date(signingRequest.expires_at) < new Date();

    if (isExpired) {
      return NextResponse.json({ error: 'This signing link is invalid or has expired' }, { status: 404 });
    }

    if (signingRequest.status !== 'pending') {
      return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 });
    }

    // Decline branch -- the signer chose not to sign. No PDF stamping,
    // just a status change plus a best-effort email letting the TC know
    // (rather than leaving them staring at a silently-stuck "Awaiting
    // signature" badge with no idea why). Added 2026-09 -- previously a
    // signer's only option was to abandon the tab.
    if (decline === true) {
      const declinedAtIso = new Date().toISOString();
      const declineReason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : null;

      const { error: declineError } = await supabaseServer
        .from('signing_requests')
        .update({
          status: 'declined',
          declined_at: declinedAtIso,
          decline_reason: declineReason || null,
          updated_at: declinedAtIso,
        })
        .eq('id', signingRequest.id);

      if (declineError) throw declineError;

      try {
        const { data: tcUserData } = await supabaseServer.auth.admin.getUserById(signingRequest.requested_by);
        const tcEmail = tcUserData?.user?.email;
        if (tcEmail) {
          const resend = getResendClient();
          await resend.emails.send({
            from: INVOICE_FROM_EMAIL,
            to: tcEmail,
            subject: `Signature declined: ${signingRequest.source_file_name}`,
            html: `
              <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
                <p><strong>${signingRequest.signer_name}</strong> (${signingRequest.signer_email}) declined to sign
                <strong>${signingRequest.source_file_name}</strong>.</p>
                ${declineReason ? `<p>Their note: "${declineReason}"</p>` : ''}
                <p style="font-size: 13px; color: #666;">You can send a corrected request or reach out to them directly from Relay TC.</p>
              </div>
            `,
          });
        }
      } catch (emailError) {
        // The decline itself was recorded successfully -- a failed
        // notification email shouldn't fail the signer's request.
        console.error('Failed to email TC about declined signature (non-fatal):', emailError);
      }

      return NextResponse.json({ success: true, status: 'declined' });
    }

    if (consent !== true) {
      return NextResponse.json({ error: 'You must confirm consent to sign electronically' }, { status: 400 });
    }
    if (signatureType !== 'typed' && signatureType !== 'drawn') {
      return NextResponse.json({ error: 'Invalid signature type' }, { status: 400 });
    }
    if (typeof signatureValue !== 'string' || !signatureValue.trim()) {
      return NextResponse.json({ error: 'A signature is required' }, { status: 400 });
    }

    const { data: fileBlob, error: downloadError } = await supabaseServer.storage
      .from(BUCKET)
      .download(signingRequest.source_storage_path);

    if (downloadError || !fileBlob) {
      return NextResponse.json({ error: 'Could not read the source document from storage' }, { status: 500 });
    }

    const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
    const signedAtIso = new Date().toISOString();
    const signerIp = getClientIp(request);
    const signerUserAgent = request.headers.get('user-agent');

    const signedPdfBytes = await stampSignatureCertificate({
      pdfBytes: sourceBytes,
      signerName: signingRequest.signer_name,
      signerEmail: signingRequest.signer_email,
      signedAtIso,
      signerIp,
      documentHash: signingRequest.document_hash,
      signatureType,
      signatureValue,
    });

    const signedFileName = signingRequest.source_file_name.replace(/\.pdf$/i, '') + ' (Signed).pdf';
    const signedStoragePath = `${signingRequest.transaction_id}/${crypto.randomUUID()}-${signedFileName.replace(/[^a-zA-Z0-9._() -]/g, '_')}`;

    const { error: uploadError } = await supabaseServer.storage
      .from(BUCKET)
      .upload(signedStoragePath, signedPdfBytes, { contentType: 'application/pdf', upsert: false });

    if (uploadError) throw uploadError;

    // Inherit the original document's category/type for the new signed
    // copy, when it still exists -- falls back to sensible defaults if
    // the source document was since deleted (the signing request itself
    // still has its own snapshot of the file, independent of that row).
    let category = 'contract_disclosures';
    let documentType = 'Other Contract Documents';
    if (signingRequest.document_id) {
      const { data: sourceDoc } = await supabaseServer
        .from('documents')
        .select('category, document_type')
        .eq('id', signingRequest.document_id)
        .maybeSingle();
      if (sourceDoc?.category) category = sourceDoc.category;
      if (sourceDoc?.document_type) documentType = sourceDoc.document_type;
    }

    const { data: signedDocRow, error: docInsertError } = await supabaseServer
      .from('documents')
      .insert({
        transaction_id: signingRequest.transaction_id,
        category,
        document_type: documentType,
        file_name: signedFileName,
        storage_path: signedStoragePath,
        content_type: 'application/pdf',
        file_size: signedPdfBytes.byteLength,
        is_signed: true,
      })
      .select()
      .single();

    if (docInsertError) {
      console.error('Signed PDF stored, but failed to add it to Documents (non-fatal):', docInsertError);
    }

    const { error: updateError } = await supabaseServer
      .from('signing_requests')
      .update({
        status: 'signed',
        signature_type: signatureType,
        signed_at: signedAtIso,
        signer_ip: signerIp,
        signer_user_agent: signerUserAgent,
        signed_storage_path: signedStoragePath,
        signed_document_id: signedDocRow?.id || null,
        updated_at: signedAtIso,
      })
      .eq('id', signingRequest.id);

    if (updateError) throw updateError;

    const { data: downloadSigned } = await supabaseServer.storage
      .from(BUCKET)
      .createSignedUrl(signedStoragePath, PREVIEW_URL_TTL_SECONDS);

    return NextResponse.json({ success: true, downloadUrl: downloadSigned?.signedUrl || null });
  } catch (error) {
    console.error('Error submitting signature:', error);
    return NextResponse.json({ error: 'Failed to submit signature' }, { status: 500 });
  }
}
