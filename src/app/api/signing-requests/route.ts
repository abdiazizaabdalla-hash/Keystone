import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { generateSigningToken, hashDocumentBytes } from '@/lib/signing';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { getVisibleTcUserIds } from '@/lib/team';
import { escapeHtml } from '@/lib/escapeHtml';

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
      .select('id, document_id, signer_name, signer_email, source_file_name, status, signed_at, signed_document_id, created_at, expires_at, voided_at, declined_at, decline_reason')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching signing requests:', error);
    return NextResponse.json({ error: 'Failed to fetch signing requests' }, { status: 500 });
  }
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
    const { documentId, signerName, signerEmail } = body;

    if (!documentId || typeof documentId !== 'string') {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }
    if (!signerName || typeof signerName !== 'string' || !signerName.trim()) {
      return NextResponse.json({ error: 'Signer name is required' }, { status: 400 });
    }
    if (!signerEmail || typeof signerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
      return NextResponse.json({ error: 'A valid signer email is required' }, { status: 400 });
    }

    const { data: document, error: docError } = await supabaseServer
      .from('documents')
      .select('id, transaction_id, file_name, storage_path, content_type')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const looksLikePdf =
      document.content_type === 'application/pdf' || document.file_name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      return NextResponse.json({ error: 'Only PDF documents can be sent for signature' }, { status: 400 });
    }

    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, agent_id, file_number, property_address')
      .eq('id', document.transaction_id)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .eq('tc_user_id', user.id)
        .single();
      if (!agent) {
        return NextResponse.json(
          { error: 'You do not have permission to request a signature for this document' },
          { status: 403 }
        );
      }
    }

    const { data: fileBlob, error: downloadError } = await supabaseServer.storage
      .from(BUCKET)
      .download(document.storage_path);

    if (downloadError || !fileBlob) {
      return NextResponse.json({ error: 'Could not read the source document from storage' }, { status: 500 });
    }

    const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
    const documentHash = hashDocumentBytes(sourceBytes);
    const token = generateSigningToken();

    const expiresAt = new Date(Date.now() + SIGNING_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: signingRequest, error: insertError } = await supabaseServer
      .from('signing_requests')
      .insert({
        transaction_id: transaction.id,
        document_id: document.id,
        requested_by: user.id,
        signer_name: signerName.trim(),
        signer_email: signerEmail.trim(),
        source_storage_path: document.storage_path,
        source_file_name: document.file_name,
        document_hash: documentHash,
        token,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const origin = new URL(request.url).origin;
    const signUrl = `${origin}/sign/${token}`;

    try {
      const resend = getResendClient();
      await resend.emails.send({
        from: INVOICE_FROM_EMAIL,
        to: signerEmail.trim(),
        subject: `Signature requested: ${document.file_name}`,
        html: `
          <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
            <p>Hi ${escapeHtml(signerName.trim().split(' ')[0] || signerName.trim())},</p>
            <p>You've been asked to sign <strong>${escapeHtml(document.file_name)}</strong> for ${escapeHtml(transaction.property_address)} (file #${escapeHtml(transaction.file_number)}).</p>
            <p><a href="${signUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Review &amp; Sign</a></p>
            <p style="font-size: 13px; color: #666;">Or paste this link into your browser: ${signUrl}</p>
          </div>
        `,
      });
    } catch (emailError) {
      // The signing request itself was created successfully -- a failed
      // email just means the TC needs to share the link another way.
      // Never fail the whole request over Resend being unreachable.
      console.error('Failed to email signing request (non-fatal):', emailError);
    }

    return NextResponse.json({ ...signingRequest, signUrl }, { status: 201 });
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
