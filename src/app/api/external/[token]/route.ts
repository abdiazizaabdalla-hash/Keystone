import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { formatDisplayDate } from '@/lib/dueDates';

const BUCKET = 'transaction-documents';
const PREVIEW_URL_TTL_SECONDS = 60 * 30; // 30 minutes, same as the signing-requests public route

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

// GET /api/external/[token] -- PUBLIC, no auth. The token itself IS the
// auth, same pattern as /api/signing-requests/public/[token]. Returns
// ONLY what this link's scope allows: either one document's signed
// preview URL, or this deal's address/file number plus its key dates --
// never pricing, contacts, messages, or any other document.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ip = getClientIp(request) || 'unknown';
  const [ipOk, tokenOk] = await Promise.all([
    checkRateLimit(`external-get:ip:${ip}`, 60, 5 * 60),
    checkRateLimit(`external-get:token:${token}`, 30, 5 * 60),
  ]);
  if (!ipOk || !tokenOk) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 });
  }

  const { data: link, error } = await supabaseServer
    .from('external_access_links')
    .select('id, transaction_id, scope, document_id, revoked_at, expires_at, access_count')
    .eq('token', token)
    .single();

  if (error || !link) {
    return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
  }

  const isExpired = new Date(link.expires_at) < new Date();
  if (isExpired || link.revoked_at) {
    return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
  }

  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('file_number, property_address, acceptance_date, closing_date')
    .eq('id', link.transaction_id)
    .single();

  if (!transaction) {
    return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
  }

  // Best-effort visit tracking for the TC's own list -- never blocks the
  // visitor's response if it fails.
  try {
    await supabaseServer
      .from('external_access_links')
      .update({ last_accessed_at: new Date().toISOString(), access_count: (link.access_count || 0) + 1 })
      .eq('id', link.id);
  } catch {
    // non-fatal
  }

  if (link.scope === 'dates') {
    const { data: tasks } = await supabaseServer
      .from('tasks')
      .select('name, due_date')
      .eq('transaction_id', link.transaction_id)
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true });

    return NextResponse.json({
      scope: 'dates',
      propertyAddress: transaction.property_address,
      fileNumber: transaction.file_number,
      acceptanceDate: transaction.acceptance_date,
      closingDate: transaction.closing_date,
      dates: (tasks || []).map((t) => ({
        label: t.name as string,
        date: t.due_date as string,
        dateDisplay: formatDisplayDate(t.due_date as string),
      })),
    });
  }

  // scope === 'document'
  const { data: doc } = await supabaseServer
    .from('documents')
    .select('file_name, storage_path, content_type')
    .eq('id', link.document_id)
    .single();

  if (!doc) {
    return NextResponse.json({ error: 'This document is no longer available' }, { status: 404 });
  }

  const { data: signed } = await supabaseServer.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, PREVIEW_URL_TTL_SECONDS);

  return NextResponse.json({
    scope: 'document',
    propertyAddress: transaction.property_address,
    fileNumber: transaction.file_number,
    fileName: doc.file_name,
    contentType: doc.content_type,
    previewUrl: signed?.signedUrl || null,
  });
}
