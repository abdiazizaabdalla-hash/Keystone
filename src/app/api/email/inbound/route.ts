import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getVisibleTcUserIds } from '@/lib/team';
import { sanitizeEmailHtml } from '@/lib/emailHtml';

/**
 * Per-transaction email ingestion (Phase 2, Section 21 of the roadmap).
 *
 * POST is the inbound webhook Resend calls (configure its Inbound
 * domain's webhook destination to point here). A TC forwards or CCs
 * mail about a deal to that transaction's own address --
 * `deal-<inbound_token>@<your inbound domain>` -- and it lands here,
 * threaded onto the transaction instead of staying stuck in an inbox.
 *
 * GET lists the emails already ingested for a transaction, for the
 * Communication card on the transaction page (same ownership/visibility
 * rule as /api/documents, /api/tasks, etc.).
 *
 * Resend's webhook payload is METADATA ONLY -- from/to/subject/
 * attachment metadata, no body or attachment content (see
 * resend.com/docs/webhooks/emails/received). The body and each
 * attachment's actual bytes have to be fetched separately via Resend's
 * Receiving API, which is why this handler makes its own API calls back
 * to Resend rather than trusting the webhook payload alone.
 */

const RESEND_API_BASE = 'https://api.resend.com';
const BUCKET = 'transaction-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, matching GET /api/documents

// Resend signs webhooks the same way Svix does, but the installed
// `resend` SDK version (6.28) has no webhooks.verify() helper, so this
// is done by hand with Node's built-in crypto -- no new dependency.
// Algorithm: https://docs.svix.com/receiving/verifying-payloads/how-manual
function verifySignature(
  rawBody: string,
  headers: { id: string; timestamp: string; signature: string }
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected);

  // svix-signature is space-delimited "v1,<base64sig>" entries -- Resend
  // can list more than one during a secret rotation, so check all of
  // them rather than only the first.
  return headers.signature
    .split(' ')
    .map((entry) => entry.split(',')[1])
    .filter(Boolean)
    .some((candidate) => {
      const candidateBuf = Buffer.from(candidate);
      if (candidateBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(candidateBuf, expectedBuf);
    });
}

interface ReceivedEmailAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

interface ReceivedEmail {
  id: string;
  from: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  attachments: ReceivedEmailAttachment[];
}

async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const res = await fetch(`${RESEND_API_BASE}/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend GET received email failed: ${res.status}`);
  return res.json();
}

async function fetchAttachmentDownloadUrl(emailId: string, attachmentId: string): Promise<string> {
  const res = await fetch(`${RESEND_API_BASE}/emails/receiving/${emailId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend GET attachment failed: ${res.status}`);
  const data = await res.json();
  return data.download_url as string;
}

// Pulls the per-transaction token out of a recipient address, e.g.
// "deal-a1b2c3d4@mail.relaytc.com" or the bare "a1b2c3d4@..." -> the
// 8-char token. Lowercased since email local parts are treated
// case-insensitively everywhere that matters here.
function extractToken(address: string): string | null {
  const local = address.split('@')[0]?.trim().toLowerCase();
  if (!local) return null;
  const match = local.match(/^(?:deal-)?([a-f0-9]{8,16})$/);
  return match ? match[1] : null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 });
  }
  // Reject replays: Svix timestamps older/newer than 5 minutes are not accepted.
  const tsSeconds = Number(svixTimestamp);
  if (!Number.isFinite(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 5 * 60) {
    return NextResponse.json({ error: 'Timestamp outside tolerance' }, { status: 400 });
  }
  if (!verifySignature(rawBody, { id: svixId, timestamp: svixTimestamp, signature: svixSignature })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event?.type !== 'email.received') {
    // This endpoint is only meant to be wired up for email.received in
    // the Resend dashboard, but no harm in being defensive.
    return NextResponse.json({ ignored: true });
  }

  const data = event.data as {
    email_id: string;
    to: string[];
    received_for?: string[];
  };

  // Check every recipient address on the message (to + the catch-all's
  // received_for), not just the first "to" -- a TC may have CC'd the
  // transaction address while someone else was the primary recipient.
  const candidates = [...(data.to || []), ...(data.received_for || [])];
  const token = candidates.map(extractToken).find(Boolean);

  if (!token) {
    console.warn('email/inbound: no recognizable transaction address on message', { candidates });
    return NextResponse.json({ matched: false, reason: 'no recognizable transaction address' });
  }

  const { data: transaction, error: txError } = await supabaseServer
    .from('transactions')
    .select('id, agent_id')
    .eq('inbound_token', token)
    .maybeSingle();

  if (txError) {
    console.error('email/inbound: transaction lookup failed', txError);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!transaction) {
    console.warn('email/inbound: no transaction matched token', { token });
    return NextResponse.json({ matched: false });
  }

  const full = await fetchReceivedEmail(data.email_id);

  const fromMatch = full.from.match(/^(.*?)<([^>]+)>$/);
  const fromName = fromMatch ? fromMatch[1].trim().replace(/^"|"$/g, '') || null : null;
  const fromEmail = fromMatch ? fromMatch[2].trim() : full.from;

  const { data: emailRow, error: insertError } = await supabaseServer
    .from('transaction_emails')
    .insert({
      transaction_id: transaction.id,
      resend_email_id: full.id,
      from_email: fromEmail,
      from_name: fromName,
      to_email: candidates[0] || '',
      subject: full.subject,
      body_text: full.text,
      body_html: full.html,
      received_at: event.created_at || new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    // 23505 = unique_violation on resend_email_id -- Resend (like most
    // webhook senders) can redeliver the same event; already ingested
    // is a no-op, not a real failure.
    if ((insertError as { code?: string }).code === '23505') {
      return NextResponse.json({ matched: true, duplicate: true });
    }
    console.error('email/inbound: failed to insert email', insertError);
    return NextResponse.json({ error: 'Failed to store email' }, { status: 500 });
  }

  // File each attachment into the existing Documents system, tagged as
  // email-sourced. Best-effort per attachment -- one bad attachment
  // shouldn't lose the whole email or the ones before it.
  const { data: agentRow } = await supabaseServer
    .from('agents')
    .select('tc_user_id')
    .eq('id', transaction.agent_id)
    .single();
  const uploadedBy = agentRow?.tc_user_id ?? null;

  let filedCount = 0;
  for (const attachment of full.attachments || []) {
    try {
      const downloadUrl = await fetchAttachmentDownloadUrl(full.id, attachment.id);
      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) throw new Error(`download failed: ${fileRes.status}`);
      const buffer = await fileRes.arrayBuffer();

      const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${transaction.id}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await supabaseServer.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: attachment.content_type || 'application/octet-stream',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: docInsertError } = await supabaseServer.from('documents').insert({
        transaction_id: transaction.id,
        category: 'other',
        document_type: 'General',
        file_name: attachment.filename,
        storage_path: storagePath,
        content_type: attachment.content_type || null,
        file_size: attachment.size,
        uploaded_by: uploadedBy,
        requires_signature: false,
        source: 'email',
        source_email_id: emailRow.id,
      });
      if (docInsertError) throw docInsertError;
      filedCount += 1;
    } catch (err) {
      console.error('email/inbound: failed to file attachment', attachment.filename, err);
    }
  }

  return NextResponse.json({ matched: true, emailId: emailRow.id, attachmentsFiled: filedCount });
}

// Lets a TC remove a forwarded email from the Communication card -- e.g.
// something irrelevant that got CC'd in, or sent to the wrong deal. Owner
// -only, matching DELETE /api/documents (a team owner can view a
// teammate's forwarded emails via GET above, but not delete them).
//
// Attachments this email had filed into the Documents system
// (documents.source_email_id) are cleaned up here too: the FK is
// ON DELETE SET NULL, not CASCADE, so without this they'd survive the
// email's deletion as orphaned, unlabeled documents -- still taking up
// storage and still showing up in the Documents list with no indication
// of where they came from.
export async function DELETE(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Email id is required' }, { status: 400 });
    }

    const { data: email, error: fetchError } = await supabaseServer
      .from('transaction_emails')
      .select('id, transaction_id')
      .eq('id', id)
      .single();

    if (fetchError || !email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', email.transaction_id)
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
        return NextResponse.json({ error: 'You do not have permission to delete this email' }, { status: 403 });
      }
    }

    const { data: attachmentDocs, error: attachmentsFetchError } = await supabaseServer
      .from('documents')
      .select('id, storage_path')
      .eq('source_email_id', id);

    if (attachmentsFetchError) throw attachmentsFetchError;

    for (const doc of attachmentDocs || []) {
      // Best-effort, same as DELETE /api/documents -- a storage removal
      // failure shouldn't block clearing the DB row and the email itself.
      const { error: removeError } = await supabaseServer.storage.from(BUCKET).remove([doc.storage_path as string]);
      if (removeError) console.warn('email/inbound DELETE: storage removal failed, deleting row anyway', removeError);
    }

    if (attachmentDocs && attachmentDocs.length > 0) {
      const { error: deleteDocsError } = await supabaseServer
        .from('documents')
        .delete()
        .in('id', attachmentDocs.map((doc) => doc.id));
      if (deleteDocsError) throw deleteDocsError;
    }

    const { error: deleteEmailError } = await supabaseServer.from('transaction_emails').delete().eq('id', id);
    if (deleteEmailError) throw deleteEmailError;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting transaction email:', error);
    return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const visibleIds = await getVisibleTcUserIds(user.id);
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .in('tc_user_id', visibleIds)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to view this transaction' }, { status: 403 });
      }
    }

    const { data, error } = await supabaseServer
      .from('transaction_emails')
      .select('id, from_email, from_name, subject, body_text, body_html, received_at')
      .eq('transaction_id', transactionId)
      .order('received_at', { ascending: false });

    if (error) throw error;

    const emails = data || [];
    const emailIds = emails.map((e) => e.id as string);

    // Attachments filed from these emails already live in the regular
    // documents table (see the POST handler above), tagged with which
    // email they came from via source_email_id -- they were just never
    // queried back out and attached to the email itself before now, so
    // the Communication card had no way to show them. Signed URLs use
    // the same mechanism and TTL as GET /api/documents.
    const attachmentsByEmailId = new Map<
      string,
      { id: string; fileName: string; fileSize: number | null; contentType: string | null; url: string | null }[]
    >();

    if (emailIds.length > 0) {
      const { data: attachmentDocs, error: attachmentsError } = await supabaseServer
        .from('documents')
        .select('id, file_name, file_size, content_type, storage_path, source_email_id')
        .in('source_email_id', emailIds);

      if (attachmentsError) throw attachmentsError;

      for (const doc of attachmentDocs || []) {
        const { data: signed } = await supabaseServer.storage
          .from(BUCKET)
          .createSignedUrl(doc.storage_path as string, SIGNED_URL_TTL_SECONDS);

        const emailId = doc.source_email_id as string;
        const list = attachmentsByEmailId.get(emailId) || [];
        list.push({
          id: doc.id as string,
          fileName: doc.file_name as string,
          fileSize: (doc.file_size as number | null) ?? null,
          contentType: (doc.content_type as string | null) ?? null,
          url: signed?.signedUrl || null,
        });
        attachmentsByEmailId.set(emailId, list);
      }
    }

    const withBodyAndAttachments = emails.map((email) => ({
      ...email,
      // Sanitized at read time, not write time -- see src/lib/emailHtml.ts.
      // Keeping the raw HTML in storage and sanitizing on every read means
      // tightening the sanitizer later doesn't require re-processing or
      // losing anything already stored.
      body_html: email.body_html ? sanitizeEmailHtml(email.body_html as string) : null,
      attachments: attachmentsByEmailId.get(email.id as string) || [],
    }));

    return NextResponse.json(withBodyAndAttachments);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching transaction emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  }
}
