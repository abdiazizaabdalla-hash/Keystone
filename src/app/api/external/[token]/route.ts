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
      .select('name, completed, client_visible, sort_order, due_date')
      .eq('transaction_id', link.transaction_id)
      .order('sort_order', { ascending: true });
    const ordered = allTasks || [];
    const stages = stagesForTaskNames(ordered.map((t) => t.name as string));
    const currentStage = (transaction.status as string) || stages[0];
    const stageIndex = Math.max(0, stages.indexOf(currentStage));

    const { data: keyDates } = await supabaseServer
      .from('transaction_key_dates')
      .select('kind, label, due_date, completed')
      .eq('transaction_id', link.transaction_id)
      .order('due_date', { ascending: true });

    // Plain-English reasons for each kind of date, so a client who has never
    // bought or sold before knows why it matters.
    const KIND_HELP: Record<string, string> = {
      accepted: 'The day both sides agreed to the contract. The deadlines below count from here.',
      earnest_money: 'Your good-faith deposit is due to the title or escrow company by this date.',
      inspection: 'The last day to finish inspections and ask for repairs or credits.',
      appraisal: "The lender's appraisal should be done by this date to confirm the home's value.",
      financing: 'Your loan approval needs to be in place by this date.',
      title_commitment: 'The title company confirms ownership of the property is clear.',
      closing: 'Signing day: ownership officially transfers.',
    };
    type PortalDate = { label: string; kind: string; help: string | null; date: string; dateDisplay: string; completed: boolean };
    const dates: PortalDate[] = [];
    const hasClosingKeyDate = (keyDates || []).some((d) => d.kind === 'closing' && d.due_date);
    if (transaction.acceptance_date) {
      dates.push({ label: 'Contract accepted', kind: 'accepted', help: KIND_HELP.accepted, date: transaction.acceptance_date as string, dateDisplay: formatDisplayDate(transaction.acceptance_date as string), completed: true });
    }
    (keyDates || []).forEach((d) => {
      if (d.due_date) {
        const kind = (d.kind as string) || 'custom';
        dates.push({ label: d.label as string, kind, help: KIND_HELP[kind] ?? null, date: d.due_date as string, dateDisplay: formatDisplayDate(d.due_date as string), completed: Boolean(d.completed) });
      }
    });
    if (transaction.closing_date && !hasClosingKeyDate) {
      dates.push({ label: 'Closing', kind: 'closing', help: KIND_HELP.closing, date: transaction.closing_date as string, dateDisplay: formatDisplayDate(transaction.closing_date as string), completed: false });
    }
    dates.sort((a, b) => a.date.localeCompare(b.date));

    // Who the client can message: their agent and the coordinator.
    const people: { agentName: string | null; tcName: string | null } = { agentName: null, tcName: null };
    const { data: tx } = await supabaseServer.from('transactions').select('agent_id').eq('id', link.transaction_id).maybeSingle();
    if (tx?.agent_id) {
      const { data: agentRecord } = await supabaseServer.from('agents').select('name, tc_user_id').eq('id', tx.agent_id).maybeSingle();
      people.agentName = (agentRecord?.name as string | null) ?? null;
      if (agentRecord?.tc_user_id) {
        const { data: tcUser } = await supabaseServer.auth.admin.getUserById(agentRecord.tc_user_id as string);
        const meta = tcUser.user?.user_metadata as Record<string, unknown> | undefined;
        people.tcName = (typeof meta?.full_name === 'string' && meta.full_name.trim()) || null;
      }
    }

    const { data: sharedDocs } = await supabaseServer
      .from('documents')
      .select('id, file_name, file_size, category, document_type, created_at')
      .eq('transaction_id', link.transaction_id)
      .eq('client_visible', true)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      scope: 'progress',
      documents: (sharedDocs || []).map((d) => ({
        id: d.id as string,
        fileName: d.file_name as string,
        fileSize: (d.file_size as number | null) ?? null,
        category: (d.category as string | null) ?? 'other',
        documentType: (d.document_type as string | null) ?? null,
      })),
      people,
      propertyAddress: transaction.property_address,
      clientName: link.client_name || null,
      note: link.client_note || null,
      stages,
      stageIndex,
      currentStage,
      steps: ordered
        .filter((t) => t.client_visible)
        .map((t) => ({
          name: t.name as string,
          completed: Boolean(t.completed),
          dueDate: (t.due_date as string | null) ?? null,
        })),
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
