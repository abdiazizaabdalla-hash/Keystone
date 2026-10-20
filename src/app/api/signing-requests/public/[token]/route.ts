import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { stampSignatureCertificate, stampSignatureFields, hashDocumentBytes } from '@/lib/signing';
import { sendSigningRequestEmail } from '@/lib/signingEmails';
import { parseSigningFields } from '@/lib/signingFields';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { checkRateLimit } from '@/lib/rateLimit';
import { sendSignedCopies, parseRecipients } from '@/lib/signedCopies';

const BUCKET = 'transaction-documents';
const PREVIEW_URL_TTL_SECONDS = 60 * 30; // 30 minutes -- plenty for one signing session
const SIGNING_LINK_EXPIRY_DAYS = 14; // same window as when a request is created

// Best-effort real client IP from standard proxy headers (Vercel sets
// x-forwarded-for). Used for the audit trail on POST and as a rate-limit
// bucket on both handlers -- a missing/spoofable value just falls back to
// a shared 'unknown' bucket rather than breaking anything.
function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

// GET /api/signing-requests/public/[token] -- PUBLIC, no auth. The token
// itself IS the auth (see lib/signing.ts) -- deliberately returns only
// what the signer's page needs (file name, a scoped preview link, and
// status), never anything else about the transaction.
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Where the document lives: a deal (transactions) or a listing. Gives the address/file number for emails.
async function signingContext(r: { transaction_id?: string | null; listing_id?: string | null }) {
  if (r.listing_id) {
    const { data } = await supabaseServer.from('listings').select('property_address').eq('id', r.listing_id).maybeSingle();
    return { address: (data?.property_address as string | undefined) || 'the property', fileNumber: '' };
  }
  const { data } = await supabaseServer.from('transactions').select('property_address, file_number').eq('id', r.transaction_id as string).maybeSingle();
  return { address: (data?.property_address as string | undefined) || 'the property', fileNumber: (data?.file_number as string | undefined) || '' };
}

// Listing history entry for a signing event (the signer is not a Relay user, so the signer's name is the actor).
async function logListingSigning(listingId: string | null | undefined, signerName: string, summary: string) {
  if (!listingId) return;
  try {
    await supabaseServer.from('listing_activity').insert({ listing_id: listingId, actor_label: signerName.slice(0, 200), summary: summary.slice(0, 500) });
  } catch (error) {
    console.error('Listing signing activity failed (ignored):', error);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // The token's own entropy is what actually prevents guessing it; this
  // just caps how hard one IP or one link can hammer this endpoint
  // (scraping, accidental polling loops, etc).
  const ip = getClientIp(request) || 'unknown';
  const [ipOk, tokenOk] = await Promise.all([
    checkRateLimit(`signing-get:ip:${ip}`, 60, 5 * 60),
    checkRateLimit(`signing-get:token:${token}`, 30, 5 * 60),
  ]);
  if (!ipOk || !tokenOk) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 });
  }

  const { data: signingRequest, error } = await supabaseServer
    .from('signing_requests')
    .select('*')
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

  // Multi-signer requests: later signers hold a valid link from the start
  // but can't see or sign the document until the signer before them is done.
  if (signingRequest.awaiting_turn) {
    return NextResponse.json({
      status: 'waiting',
      fileName: signingRequest.source_file_name,
      signerName: signingRequest.signer_name,
    });
  }

  const { data: signed } = await supabaseServer.storage
    .from(BUCKET)
    .createSignedUrl(signingRequest.source_storage_path, PREVIEW_URL_TTL_SECONDS);

  // Placed signature spots, if the TC set any (else the signature goes on
  // a certificate page, as before). Re-validated on the way out so a bad
  // row can never break the signing page.
  const placed = parseSigningFields(signingRequest.fields).fields;

  return NextResponse.json({
    status: 'pending',
    fileName: signingRequest.source_file_name,
    signerName: signingRequest.signer_name,
    previewUrl: signed?.signedUrl || null,
    fields: placed,
  });
}

// POST /api/signing-requests/public/[token] -- PUBLIC, no auth. Submits
// the signer's signature: stamps a Signature Certificate page onto the
// original PDF (lib/signing.ts), stores the result, records the audit
// trail, and adds the signed PDF to the transaction's Documents list.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    const ip = getClientIp(request) || 'unknown';
    const [ipOk, tokenOk] = await Promise.all([
      checkRateLimit(`signing-post:ip:${ip}`, 20, 10 * 60),
      checkRateLimit(`signing-post:token:${token}`, 10, 10 * 60),
    ]);
    if (!ipOk || !tokenOk) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 });
    }

    const body = await request.json();
    const { signatureType, signatureValue, consent, decline, reason, initials } = body;

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

    if (signingRequest.awaiting_turn) {
      return NextResponse.json({ error: "It isn't your turn to sign yet. We'll email you when it is." }, { status: 409 });
    }

    // Decline branch -- the signer chose not to sign. No PDF stamping,
    // just a status change plus a best-effort email letting the TC know
    // (rather than leaving them staring at a silently-stuck "Awaiting
    // signature" badge with no idea why). Added 2026-09 -- previously a
    // signer's only option was to abandon the tab.
    if (decline === true) {
      const declinedAtIso = new Date().toISOString();
      const declineReason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : null;

      const { data: declinedRows, error: declineError } = await supabaseServer
        .from('signing_requests')
        .update({
          status: 'declined',
          declined_at: declinedAtIso,
          decline_reason: declineReason || null,
          updated_at: declinedAtIso,
        })
        .eq('id', signingRequest.id)
        .eq('status', 'pending')
        .select('id');

      if (declineError) throw declineError;
      if (!declinedRows || declinedRows.length === 0) {
        return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 });
      }

      // Anyone still waiting behind this signer will never get their turn,
      // so close those requests too (their links stop working).
      if (signingRequest.group_id) {
        await supabaseServer
          .from('signing_requests')
          .update({ status: 'voided', voided_at: declinedAtIso, updated_at: declinedAtIso })
          .eq('group_id', signingRequest.group_id)
          .eq('status', 'pending')
          .neq('id', signingRequest.id);
      }

      await logListingSigning(signingRequest.listing_id, signingRequest.signer_name, `Declined to sign ${signingRequest.source_file_name}`);

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
                <p><strong>${escapeHtml(signingRequest.signer_name)}</strong> (${escapeHtml(signingRequest.signer_email)}) declined to sign
                <strong>${escapeHtml(signingRequest.source_file_name)}</strong>.</p>
                ${declineReason ? `<p>Their note: "${escapeHtml(declineReason)}"</p>` : ''}
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

    // Is someone still due to sign after this person? (Multi-signer
    // requests only; everything else is its own final signer.)
    let nextRequest: { id: string; signer_name: string; signer_email: string; token: string } | null = null;
    if (signingRequest.group_id) {
      const { data: laterRows } = await supabaseServer
        .from('signing_requests')
        .select('id, signer_name, signer_email, token')
        .eq('group_id', signingRequest.group_id)
        .eq('status', 'pending')
        .gt('signing_order', signingRequest.signing_order ?? 1)
        .order('signing_order', { ascending: true })
        .limit(1);
      nextRequest = laterRows?.[0] ?? null;
    }
    const isFinalSigner = !nextRequest;

    const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
    const signedAtIso = new Date().toISOString();
    const signerIp = getClientIp(request);
    const signerUserAgent = request.headers.get('user-agent');

    // If the TC placed signature spots, stamp the signature / initials /
    // date into them first; the certificate page is still appended after,
    // so the audit trail is always part of the signed document.
    const placedFields = parseSigningFields(signingRequest.fields).fields;
    let pdfToCertify: Uint8Array = sourceBytes;
    if (placedFields.length > 0) {
      const needsInitials = placedFields.some((f) => f.type === 'initials');
      const initialsText = typeof initials === 'string' ? initials.trim().slice(0, 6) : '';
      if (needsInitials && !initialsText) {
        return NextResponse.json({ error: 'Please enter your initials' }, { status: 400 });
      }
      pdfToCertify = await stampSignatureFields({
        pdfBytes: sourceBytes,
        fields: placedFields,
        signatureType,
        signatureValue,
        initials: initialsText,
        signedAtIso,
      });
    }

    const signedPdfBytes = await stampSignatureCertificate({
      pdfBytes: pdfToCertify,
      signerName: signingRequest.signer_name,
      signerEmail: signingRequest.signer_email,
      signedAtIso,
      signerIp,
      documentHash: signingRequest.document_hash,
      signatureType,
      signatureValue,
    });

    const signedFileName = signingRequest.source_file_name.replace(/\.pdf$/i, '') + ' (Signed).pdf';
    const signedStoragePath = `${signingRequest.listing_id ? `listings/${signingRequest.listing_id}` : signingRequest.transaction_id}/${crypto.randomUUID()}-${signedFileName.replace(/[^a-zA-Z0-9._() -]/g, '_')}`;

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
    if (isFinalSigner && signingRequest.document_id) {
      const { data: sourceDoc } = await supabaseServer
        .from('documents')
        .select('category, document_type')
        .eq('id', signingRequest.document_id)
        .maybeSingle();
      if (sourceDoc?.category) category = sourceDoc.category;
      if (sourceDoc?.document_type) documentType = sourceDoc.document_type;
    }
    let listingDocType = 'Other Contract Documents';
    if (isFinalSigner && signingRequest.listing_document_id) {
      const { data: sourceListingDoc } = await supabaseServer
        .from('listing_documents')
        .select('document_type')
        .eq('id', signingRequest.listing_document_id)
        .maybeSingle();
      if (sourceListingDoc?.document_type) listingDocType = sourceListingDoc.document_type as string;
    }

    // Only the final signer's output becomes a Document -- earlier
    // signers' partially-signed PDFs are just handed to the next signer.
    let signedDocRow: { id: string } | null = null;
    let docInsertError: unknown = null;
    if (isFinalSigner && signingRequest.listing_id) {
      let result = await supabaseServer
        .from('listing_documents')
        .insert({
          listing_id: signingRequest.listing_id,
          file_name: signedFileName,
          storage_path: signedStoragePath,
          content_type: 'application/pdf',
          file_size: signedPdfBytes.byteLength,
          document_type: listingDocType,
          uploaded_by: signingRequest.requested_by,
          is_signed: true,
        })
        .select('id')
        .single();
      if (result.error && /is_signed/i.test(result.error.message || '')) {
        result = await supabaseServer
          .from('listing_documents')
          .insert({
            listing_id: signingRequest.listing_id,
            file_name: signedFileName,
            storage_path: signedStoragePath,
            content_type: 'application/pdf',
            file_size: signedPdfBytes.byteLength,
            document_type: listingDocType,
            uploaded_by: signingRequest.requested_by,
          })
          .select('id')
          .single();
      }
      signedDocRow = result.data as { id: string } | null;
      docInsertError = result.error;
    } else if (isFinalSigner) {
      const result = await supabaseServer
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
      signedDocRow = result.data as { id: string } | null;
      docInsertError = result.error;
    }

    if (docInsertError) {
      console.error('Signed PDF stored, but failed to add it to Documents (non-fatal):', docInsertError);
    }

    const { data: signedRows, error: updateError } = await supabaseServer
      .from('signing_requests')
      .update({
        status: 'signed',
        signature_type: signatureType,
        signed_at: signedAtIso,
        signer_ip: signerIp,
        signer_user_agent: signerUserAgent,
        signed_storage_path: signedStoragePath,
        ...(signingRequest.listing_id
          ? { signed_listing_document_id: signedDocRow?.id || null }
          : { signed_document_id: signedDocRow?.id || null }),
        updated_at: signedAtIso,
      })
      .eq('id', signingRequest.id)
      .eq('status', 'pending')
      .select('id');

    if (updateError) throw updateError;

    // Two submissions racing on the same link: only the one that flips
    // pending -> signed wins. The loser removes the copy it just stored
    // so the transaction doesn't end up with duplicate signed documents.
    if (!signedRows || signedRows.length === 0) {
      if (signedDocRow?.id) await supabaseServer.from(signingRequest.listing_id ? 'listing_documents' : 'documents').delete().eq('id', signedDocRow.id);
      await supabaseServer.storage.from(BUCKET).remove([signedStoragePath]);
      return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 });
    }

    await logListingSigning(signingRequest.listing_id, signingRequest.signer_name, `${isFinalSigner ? 'Signed' : 'Signed (more signers to go)'}: ${signingRequest.source_file_name}`);

    // Not the last signer: hand the partially-signed PDF to the next one
    // and tell them it's their turn. The link was created with the
    // original request; only now does it start working.
    if (nextRequest) {
      try {
        const ctx = await signingContext(signingRequest);

        const { error: activateError } = await supabaseServer
          .from('signing_requests')
          .update({
            awaiting_turn: false,
            source_storage_path: signedStoragePath,
            document_hash: hashDocumentBytes(Buffer.from(signedPdfBytes)),
            expires_at: new Date(Date.now() + SIGNING_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', nextRequest.id)
          .eq('status', 'pending');
        if (activateError) throw activateError;

        await sendSigningRequestEmail({
          to: nextRequest.signer_email,
          signerName: nextRequest.signer_name,
          fileName: signingRequest.source_file_name,
          propertyAddress: ctx.address,
          fileNumber: ctx.fileNumber,
          signUrl: `${new URL(request.url).origin}/sign/${nextRequest.token}`,
          previousSignerName: signingRequest.signer_name,
        });
      } catch (nextError) {
        // The signature itself is saved. If the hand-off fails the TC can
        // void and resend, so don't turn a recorded signature into an error.
        console.error('Failed to activate/email the next signer (non-fatal):', nextError);
      }
      return NextResponse.json({ success: true, downloadUrl: null, waitingOnOthers: true });
    }

    // Email the signed PDF to any extra recipients the TC listed when
    // sending the request. Best-effort: a failed email never undoes the
    // signature, but the outcome is recorded so the TC can see it.
    const copyRecipients = parseRecipients(signingRequest.distribute_to).recipients;
    if (copyRecipients.length > 0) {
      try {
        const ctx = await signingContext(signingRequest);
        const { data: tcUser } = await supabaseServer.auth.admin.getUserById(signingRequest.requested_by);

        const { sent, failed } = await sendSignedCopies({
          recipients: copyRecipients,
          subjectTemplate: signingRequest.distribute_subject ?? null,
          messageTemplate: signingRequest.distribute_message ?? null,
          replyTo: tcUser?.user?.email ?? null,
          signedPdf: signedPdfBytes,
          signedFileName,
          fields: {
            document: signingRequest.source_file_name.replace(/\.pdf$/i, ''),
            property: ctx.address,
            file_number: ctx.fileNumber,
            signer: signingRequest.signer_name,
            signed_date: new Date(signedAtIso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' }),
          },
        });

        await supabaseServer
          .from('signing_requests')
          .update({
            distributed_at: sent > 0 ? new Date().toISOString() : null,
            distribution_error: failed.length > 0 ? `Could not send to: ${failed.join(', ')}` : null,
          })
          .eq('id', signingRequest.id);
      } catch (copyError) {
        console.error('Failed to distribute signed copies (non-fatal):', copyError);
      }
    }

    const { data: downloadSigned } = await supabaseServer.storage
      .from(BUCKET)
      .createSignedUrl(signedStoragePath, PREVIEW_URL_TTL_SECONDS);

    return NextResponse.json({ success: true, downloadUrl: downloadSigned?.signedUrl || null });
  } catch (error) {
    console.error('Error submitting signature:', error);
    return NextResponse.json({ error: 'Failed to submit signature' }, { status: 500 });
  }
}
