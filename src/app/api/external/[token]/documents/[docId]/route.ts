import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { queueDealNotification } from '@/lib/notifications';

const BUCKET = 'transaction-documents';
const DOWNLOAD_URL_TTL_SECONDS = 60 * 5;

// GET /api/external/[token]/documents/[docId] -- PUBLIC; the token is the
// auth. Only works for a live progress link and only for a document the
// agent ticked "visible to client" on that same deal. Redirects to a
// fresh 5-minute signed URL each time, so the page can stay open for
// hours without a stale link and a turned-off link stops working at once.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; docId: string }> }) {
  const { token, docId } = await params;
  const notFound = () => NextResponse.json({ error: 'This document is no longer available' }, { status: 404 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  const [ipOk, tokenOk] = await Promise.all([
    checkRateLimit(`external-doc:ip:${ip}`, 60, 5 * 60),
    checkRateLimit(`external-doc:token:${token}`, 40, 5 * 60),
  ]);
  if (!ipOk || !tokenOk) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 });
  }

  const { data: link } = await supabaseServer
    .from('external_access_links')
    .select('transaction_id, scope, revoked_at, expires_at, client_name')
    .eq('token', token)
    .maybeSingle();
  if (!link || link.scope !== 'progress' || link.revoked_at || new Date(link.expires_at as string) < new Date()) {
    return notFound();
  }

  const { data: doc } = await supabaseServer
    .from('documents')
    .select('id, file_name, storage_path')
    .eq('id', docId)
    .eq('transaction_id', link.transaction_id)
    .eq('client_visible', true)
    .maybeSingle();
  if (!doc) return notFound();

  const { data: signed } = await supabaseServer.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path as string, DOWNLOAD_URL_TTL_SECONDS);
  if (!signed?.signedUrl) return notFound();

  queueDealNotification({
    transactionId: link.transaction_id as string,
    actorUserId: null,
    type: 'client_viewed',
    title: `${link.client_name || 'Your client'} opened a document`,
    body: doc.file_name as string,
  });

  return NextResponse.redirect(signed.signedUrl);
}
