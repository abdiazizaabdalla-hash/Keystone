import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { formatDisplayDate } from '@/lib/dueDates';
import { queueDealNotification } from '@/lib/notifications';
import { stagesForTaskNames } from '@/lib/transactionStages';

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
    .select('id, transaction_id, scope, document_id, revoked_at, expires_at, access_count, last_accessed_at, client_name, client_note')
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
    .select('file_number, property_address, acceptance_date, closing_date, status')
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

  if (link.scope === 'progress') {
    // Tell the TC when the client opens their link: the first time, and
    // again after a day away (not on every refresh).
    const lastSeen = link.last_accessed_at ? new Date(link.last_accessed_at).getTime() : 0;
    if (!link.access_count || Date.now() - lastSeen > 24 * 60 * 60 * 1000) {
      queueDealNotification({
        transactionId: link.transaction_id as string,
        actorUserId: null,
        type: 'client_viewed',
        title: link.client_name ? `${link.client_name} opened their progress link` : 'Your client opened their progress link',
      });
    }

    const { data: allTasks } = await supabaseServer
      .from('tasks')
      .select('name, completed, client_visible, sort_order')
      .eq('transaction_id', link.transaction_id)
      .order('sort_order', { ascending: true });
    const ordered = allTasks || [];
    const stages = stagesForTaskNames(ordered.map((t) => t.name as string));
    const currentStage = (transaction.status as string) || stages[0];
    const stageIndex = Math.max(0, stages.indexOf(currentStage));

    const { data: keyDates } = await supabaseServer
      .from('transaction_key_dates')
      .select('label, due_date, completed')
      .eq('transaction_id', link.transaction_id)
      .order('due_date', { ascending: true });

    const dates: { label: string; date: string; dateDisplay: string; completed: boolean }[] = [];
    if (transaction.acceptance_date) {
      dates.push({ label: 'Contract accepted', date: transaction.acceptance_date as string, dateDisplay: formatDisplayDate(transaction.acceptance_date as string), completed: true });
    }
    (keyDates || []).forEach((d) => {
      if (d.due_date) {
        dates.push({ label: d.label as string, date: d.due_date as string, dateDisplay: formatDisplayDate(d.due_date as string), completed: Boolean(d.completed) });
      }
    });
    if (transaction.closing_date) {
      dates.push({ label: 'Closing', date: transaction.closing_date as string, dateDisplay: formatDisplayDate(transaction.closing_date as string), completed: false });
    }
    dates.sort((a, b) => a.date.localeCompare(b.date));

    const { data: sharedDocs } = await supabaseServer
      .from('documents')
      .select('id, file_name, file_size, created_at')
      .eq('transaction_id', link.transaction_id)
      .eq('client_visible', true)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      scope: 'progress',
      documents: (sharedDocs || []).map((d) => ({
        id: d.id as string,
        fileName: d.file_name as string,
        fileSize: (d.file_size as number | null) ?? null,
      })),
      propertyAddress: transaction.property_address,
      clientName: link.client_name || null,
      note: link.client_note || null,
      stages,
      stageIndex,
      currentStage,
      steps: ordered
        .filter((t) => t.client_visible)
        .map((t) => ({ name: t.name as string, completed: Boolean(t.completed) })),
      dates,
    });
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
