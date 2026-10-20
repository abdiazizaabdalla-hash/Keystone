import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { generateSigningToken, hashDocumentBytes } from '@/lib/signing';
import { PDFDocument } from 'pdf-lib';
import { parseSigningFields, MAX_SIGNERS, type SigningField } from '@/lib/signingFields';
import { sendSigningRequestEmail } from '@/lib/signingEmails';
import { getVisibleTcUserIds } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import { parseRecipients } from '@/lib/signedCopies';
import { logListingActivity, requireListingAccess } from '@/lib/listings';

const BUCKET = 'transaction-documents';
// Signing links used to never expire at all -- found during the 2026-09
// e-signature reliability review. 14 days is generous for a real estate
// closing timeline (most signature turnarounds happen in days, not
// weeks) while still bounding how long an unguessable-but-permanent link
// stays live if a deal falls through and nobody remembers to void it.
const SIGNING_LINK_EXPIRY_DAYS = 14;

// GET /api/signing-requests?transactionId=... -- every signature request
// (pending or completed) for one transaction, for the TC's Documents view.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    const listingId = request.nextUrl.searchParams.get('listingId');

    // A listing's signature requests (same access rule as the listing itself).
    if (listingId && !transactionId) {
      await requireListingAccess(request, listingId);
      const { data: listingRows, error: listingError } = await supabaseServer
        .from('signing_requests')
        .select('*')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false });
      if (listingError) {
        // add-listing-esign.sql not run yet: there can be no listing requests.
        if (/listing_id/i.test(listingError.message || '')) return NextResponse.json([]);
        throw listingError;
      }
      return NextResponse.json((listingRows || []).map(toSafeRequest));
    }

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const { data: transaction } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', transactionId)
      .single();

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      // Read-only: a Team owner can view a teammate's signing requests
      // too, same team-wide rule as /api/transactions, /api/tasks, and
      // /api/documents (see getVisibleTcUserIds). Sending a NEW signing
      // request (the POST handler below) stays owner-only.
      const visibleIds = await getVisibleTcUserIds(user.id);
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .in('tc_user_id', visibleIds)
        .single();
      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to view this' }, { status: 403 });
      }
    }

    const { data, error } = await supabaseServer
      .from('signing_requests')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    // select('*') then pick the safe fields, so the optional "email a
    // signed copy" columns (add-signing-distribution.sql) are returned
    // when they exist without this route breaking before that migration
    // runs. The signing token and storage paths are never returned.
    return NextResponse.json((data || []).map(toSafeRequest));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching signing requests:', error);
    return NextResponse.json({ error: 'Failed to fetch signing requests' }, { status: 500 });
  }
}

// The fields the TC's browser may see -- never the token or storage paths.
// (Defined once and shared by the list and create responses.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSafeRequest(r: any) {
  return {
        id: r.id,
        document_id: r.document_id,
        listing_document_id: r.listing_document_id ?? null,
        signed_listing_document_id: r.signed_listing_document_id ?? null,
        signer_name: r.signer_name,
        signer_email: r.signer_email,
        source_file_name: r.source_file_name,
        status: r.status,
        signed_at: r.signed_at,
        signed_document_id: r.signed_document_id,
        created_at: r.created_at,
        expires_at: r.expires_at,
        voided_at: r.voided_at,
        declined_at: r.declined_at,
        decline_reason: r.decline_reason,
        distribute_to: r.distribute_to ?? [],
        distributed_at: r.distributed_at ?? null,
        distribution_error: r.distribution_error ?? null,
        group_id: r.group_id ?? null,
        signing_order: r.signing_order ?? 1,
        awaiting_turn: r.awaiting_turn ?? false,
  };
}

// POST /api/signing-requests -- TC sends an existing PDF document out for
// signature. No third-party vendor involved (see the migration note in
// database-schema.sql) -- this generates our own opaque token, emails the
// signer a link to our own public /sign/[token] page, and the signature
// gets stamped onto the document ourselves (lib/signing.ts) once they
// complete it there.
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);

    const body = await request.json();
    const { documentId, listingDocumentId, signers: rawSigners, signerName, signerEmail, sendCopyTo, copySubject, copyMessage, fields: rawFields } = body;

    const isListingDoc = typeof listingDocumentId === 'string' && listingDocumentId.length > 0;
    if (!isListingDoc && (!documentId || typeof documentId !== 'string')) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }
    // One or more signers, in signing order. The old single-signer shape
    // (signerName + signerEmail) still works and means a one-person list.
    const signerInput: unknown[] = Array.isArray(rawSigners) ? rawSigners : [{ name: signerName, email: signerEmail }];
    if (signerInput.length === 0) {
      return NextResponse.json({ error: 'Add at least one signer' }, { status: 400 });
    }
    if (signerInput.length > MAX_SIGNERS) {
      return NextResponse.json({ error: `You can add at most ${MAX_SIGNERS} signers` }, { status: 400 });
    }
    const signers: { name: string; email: string }[] = [];
    for (let i = 0; i < signerInput.length; i++) {
      const raw = signerInput[i] as { name?: unknown; email?: unknown } | null;
      const label = signerInput.length > 1 ? `Signer ${i + 1}` : 'Signer';
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      const email = typeof raw?.email === 'string' ? raw.email.trim() : '';
      if (!name || name.length > 200) {
        return NextResponse.json({ error: `${label} name is required` }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
        return NextResponse.json({ error: `A valid email is required for ${label.toLowerCase()}` }, { status: 400 });
      }
      signers.push({ name, email });
    }

    const copyRecipients = parseRecipients(sendCopyTo);
    if (copyRecipients.error) {
      return NextResponse.json({ error: copyRecipients.error }, { status: 400 });
    }
    if (copySubject !== undefined && copySubject !== null && (typeof copySubject !== 'string' || copySubject.length > 200)) {
      return NextResponse.json({ error: 'Email subject must be 200 characters or fewer' }, { status: 400 });
    }
    if (copyMessage !== undefined && copyMessage !== null && (typeof copyMessage !== 'string' || copyMessage.length > 3000)) {
      return NextResponse.json({ error: 'Email message must be 3000 characters or fewer' }, { status: 400 });
    }

    // The document being signed lives on a deal (documents) or a listing (listing_documents).
    let document: { id: string; storage_path: string; file_name: string; content_type: string | null };
    let transaction: { id: string | null; property_address: string; file_number: string };
    let listingId: string | null = null;

    if (isListingDoc) {
      const { data: listingDoc } = await supabaseServer
        .from('listing_documents')
        .select('id, listing_id, file_name, storage_path, content_type')
        .eq('id', listingDocumentId)
        .maybeSingle();
      if (!listingDoc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      // Same access rule as every other listing change (TCs on the listing's team; never agents).
      const access = await requireListingAccess(request, listingDoc.listing_id as string);
      listingId = listingDoc.listing_id as string;
      document = {
        id: listingDoc.id as string,
        storage_path: listingDoc.storage_path as string,
        file_name: listingDoc.file_name as string,
        content_type: (listingDoc.content_type as string | null) ?? null,
      };
      transaction = { id: null, property_address: access.listing.property_address as string, file_number: '' };
      if (!(document.content_type === 'application/pdf' || document.file_name.toLowerCase().endsWith('.pdf'))) {
        return NextResponse.json({ error: 'Only PDF documents can be sent for signature' }, { status: 400 });
      }
    } else {
      const { data: dealDoc, error: docError } = await supabaseServer
        .from('documents')
        .select('id, transaction_id, file_name, storage_path, content_type')
        .eq('id', documentId)
        .single();

      if (docError || !dealDoc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const looksLikePdf =
        dealDoc.content_type === 'application/pdf' || dealDoc.file_name.toLowerCase().endsWith('.pdf');
      if (!looksLikePdf) {
        return NextResponse.json({ error: 'Only PDF documents can be sent for signature' }, { status: 400 });
      }

      const { data: dealTx, error: txError } = await supabaseServer
        .from('transactions')
        .select('id, agent_id, file_number, property_address')
        .eq('id', dealDoc.transaction_id)
        .single();

      if (txError || !dealTx) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      if (!isAdmin) {
        const { data: agent } = await supabaseServer
          .from('agents')
          .select('id')
          .eq('id', dealTx.agent_id)
          .eq('tc_user_id', user.id)
          .single();
        if (!agent) {
          return NextResponse.json(
            { error: 'You do not have permission to request a signature for this document' },
            { status: 403 }
          );
        }
      }
      document = dealDoc;
      transaction = { id: dealTx.id as string, property_address: dealTx.property_address as string, file_number: dealTx.file_number as string };
    }
    const target = listingId
      ? { listing_id: listingId, listing_document_id: document.id }
      : { transaction_id: transaction.id, document_id: document.id };

    const { data: fileBlob, error: downloadError } = await supabaseServer.storage
      .from(BUCKET)
      .download(document.storage_path);

    if (downloadError || !fileBlob) {
      return NextResponse.json({ error: 'Could not read the source document from storage' }, { status: 500 });
    }

    const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
    const documentHash = hashDocumentBytes(sourceBytes);
    const token = generateSigningToken();

    // Placed signature spots (optional). Checked against the real PDF so a
    // spot can never point at a page that doesn't exist, and rotated pages
    // are refused because spot coordinates assume an upright page.
    let placedFields: SigningField[] = [];
    if (rawFields !== undefined && rawFields !== null && !(Array.isArray(rawFields) && rawFields.length === 0)) {
      let pageCount = 0;
      let hasRotatedPage = false;
      try {
        const pdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
        pageCount = pdf.getPageCount();
        hasRotatedPage = pdf.getPages().some((p) => {
          const mb = p.getMediaBox();
          const cb = p.getCropBox();
          const cropDiffers =
            Math.abs(mb.x - cb.x) > 1 || Math.abs(mb.y - cb.y) > 1 ||
            Math.abs(mb.width - cb.width) > 1 || Math.abs(mb.height - cb.height) > 1;
          return p.getRotation().angle % 360 !== 0 || cropDiffers;
        });
      } catch {
        return NextResponse.json({ error: 'Could not read this PDF to place signature spots' }, { status: 400 });
      }
      const parsedFields = parseSigningFields(rawFields, pageCount);
      if (parsedFields.error) {
        return NextResponse.json({ error: parsedFields.error }, { status: 400 });
      }
      if (parsedFields.fields.length > 0 && hasRotatedPage) {
        return NextResponse.json(
          { error: 'This PDF has rotated or cropped pages, so signature spots cannot be placed on it. Send it without spots (signature goes on a certificate page).' },
          { status: 400 }
        );
      }
      placedFields = parsedFields.fields;

      // Every spot belongs to a real signer, and (with spots in use) every
      // signer has at least one spot -- otherwise someone would be asked
      // to sign a document with nowhere to sign.
      if (placedFields.some((f) => f.signer >= signers.length)) {
        return NextResponse.json({ error: 'A signature spot is assigned to a signer who was removed' }, { status: 400 });
      }
      if (placedFields.length > 0) {
        for (let i = 0; i < signers.length; i++) {
          if (!placedFields.some((f) => f.signer === i && f.type === 'signature')) {
            return NextResponse.json(
              { error: `${signers.length > 1 ? signers[i].name : 'The signer'} needs at least one signature spot. Add one, or remove all spots.` },
              { status: 400 }
            );
          }
        }
      }
    }

    const expiresAt = new Date(Date.now() + SIGNING_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // One row per signer. Rows sent together share a group_id and a
    // signing_order; everyone after the first waits (awaiting_turn) until
    // the signer before them finishes -- see the public sign route.
    const isMulti = signers.length > 1;
    const groupId = isMulti ? crypto.randomUUID() : null;
    const tokens = signers.map((_, i) => (i === 0 ? token : generateSigningToken()));
    const rowsToInsert = signers.map((signer, i) => {
      const spotsForSigner = placedFields.filter((f) => f.signer === i);
      const isLast = i === signers.length - 1;
      return {
        ...target,
        requested_by: user.id,
        signer_name: signer.name,
        signer_email: signer.email,
        source_storage_path: document.storage_path,
        source_file_name: document.file_name,
        document_hash: documentHash,
        token: tokens[i],
        status: 'pending',
        expires_at: expiresAt,
        // Only sent when used, so signing requests keep working even
        // before the optional migrations have been run.
        ...(spotsForSigner.length > 0 ? { fields: spotsForSigner } : {}),
        ...(isMulti ? { group_id: groupId, signing_order: i + 1, awaiting_turn: i > 0 } : {}),
        // The signed copy goes out once, after the LAST signer finishes.
        // (Every row in a bulk insert must carry the same columns -- a
        // missing key becomes NULL, which distribute_to's NOT NULL rejects --
        // so earlier signers get an explicit empty list.)
        ...(copyRecipients.recipients.length > 0
          ? isLast
            ? {
                distribute_to: copyRecipients.recipients,
                distribute_subject: typeof copySubject === 'string' && copySubject.trim() ? copySubject.trim() : null,
                distribute_message: typeof copyMessage === 'string' && copyMessage.trim() ? copyMessage.trim() : null,
              }
            : { distribute_to: [], distribute_subject: null, distribute_message: null }
          : {}),
      };
    });

    // A single bulk insert is atomic: either every signer's row exists or none do.
    const { data: insertedRows, error: insertError } = await supabaseServer
      .from('signing_requests')
      .insert(rowsToInsert)
      .select();

    if (insertError || !insertedRows || insertedRows.length === 0) {
      const message = insertError?.message || '';
      if (isMulti && /group_id|signing_order|awaiting_turn/i.test(message)) {
        console.error('Signing request insert failed -- add-multiple-signers.sql probably not run:', insertError);
        return NextResponse.json(
          { error: 'Multiple signers is not set up yet. Run add-multiple-signers.sql in the Supabase SQL editor, then try again.' },
          { status: 500 }
        );
      }
      if (placedFields.length > 0 && /fields/i.test(message) && /column|schema cache/i.test(message)) {
        console.error('Signing request insert failed -- add-signing-fields.sql probably not run:', insertError);
        return NextResponse.json(
          { error: 'Placing signature spots is not set up yet. Run add-signing-fields.sql in the Supabase SQL editor, then try again.' },
          { status: 500 }
        );
      }
      // The "email a signed copy" columns come from add-signing-distribution.sql.
      // If it hasn't been run yet, say so instead of a generic failure.
      if (copyRecipients.recipients.length > 0 && /could not find|schema cache|does not exist/i.test(message) && /distribute|distributed_at|distribution_error/i.test(message)) {
        console.error('Signing request insert failed -- add-signing-distribution.sql probably not run:', insertError);
        return NextResponse.json(
          { error: 'Emailing signed copies is not set up yet. Run add-signing-distribution.sql in the Supabase SQL editor, then try again.' },
          { status: 500 }
        );
      }
      if (listingId && /listing_id|listing_document_id|transaction_id/i.test(message)) {
        console.error('Signing request insert failed -- add-listing-esign.sql probably not run:', insertError);
        return NextResponse.json(
          { error: 'Signing listing documents is not set up yet. Run add-listing-esign.sql in the Supabase SQL editor, then try again.' },
          { status: 500 }
        );
      }
      console.error('Signing request insert failed:', insertError);
      throw insertError || new Error('Signing request insert returned no rows');
    }

    const orderedRows = [...insertedRows].sort((a, b) => (a.signing_order ?? 1) - (b.signing_order ?? 1));
    const signingRequest = orderedRows[0];
    const origin = new URL(request.url).origin;
    const signUrl = `${origin}/sign/${signingRequest.token}`;

    // Only the first signer is emailed now; the rest are emailed when it
    // becomes their turn.
    try {
      await sendSigningRequestEmail({
        to: signers[0].email,
        signerName: signers[0].name,
        fileName: document.file_name,
        propertyAddress: transaction.property_address,
        fileNumber: transaction.file_number,
        signUrl,
        position: { index: 1, total: signers.length },
      });
    } catch (emailError) {
      // The signing request itself was created successfully -- a failed
      // email just means the TC needs to share the link another way.
      // Never fail the whole request over Resend being unreachable.
      console.error('Failed to email signing request (non-fatal):', emailError);
    }

    if (listingId) await logListingActivity(listingId, user, `Sent for signature: ${document.file_name} (${signers.length === 1 ? signers[0].name : `${signers.length} signers`})`);
    await logAudit(request, user, 'signing.request', { entityType: 'signing_request', entityId: signingRequest.id, metadata: { signerEmail: signers[0].email, signers: signers.length, copyRecipients: copyRecipients.recipients.length, placedFields: placedFields.length } });
    return NextResponse.json({ ...toSafeRequest(signingRequest), signUrl, requests: orderedRows.map(toSafeRequest) }, { status: 201 });
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
    console.error('Error creating signing request:', error);
    return NextResponse.json({ error: 'Failed to create signing request' }, { status: 500 });
  }
}
