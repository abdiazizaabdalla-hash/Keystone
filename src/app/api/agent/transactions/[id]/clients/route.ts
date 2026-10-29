import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { generateExternalAccessToken, PROGRESS_LINK_EXPIRY_DAYS } from '@/lib/externalAccess';
import { loadAgentContext, emailClientLink as emailLink } from '@/lib/agentClientShare';
import { checkRateLimit } from '@/lib/rateLimit';

// The agent portal's "Share with your client" card. An agent who has
// accepted a deal can give their buyer or seller a live progress page
// (the same progress-scope magic link a TC can make from their side), and
// email it to them. Everything is checked against transaction_agents via
// assertAgentOnTransaction before any link is read or created.

const LINK_COLUMNS =
  'id, client_name, client_email, client_note, token, expires_at, revoked_at, last_accessed_at, access_count, created_at';

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function handleError(error: unknown, what: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // A missing column means a database script has not been run yet. Say so
  // instead of a bare "failed", since that is the fix.
  const info = error as { code?: string; message?: string } | null;
  if (info && (info.code === '42703' || info.code === 'PGRST204' || /client_visible|client_email|client_name/.test(info.message || ''))) {
    console.error(`Error ${what} (missing column):`, error);
    return NextResponse.json(
      { error: 'The database needs one more update before this works. Run the client portal SQL scripts in Supabase (add-client-visible-documents.sql), then try again.' },
      { status: 500 }
    );
  }
  console.error(`Error ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

// GET: this deal's client progress links, plus which checklist steps clients currently see.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    await loadAgentContext(request, transactionId);

    const [{ data: links, error }, { data: visible }] = await Promise.all([
      supabaseServer
        .from('external_access_links')
        .select(LINK_COLUMNS)
        .eq('transaction_id', transactionId)
        .eq('scope', 'progress')
        .order('created_at', { ascending: false }),
      supabaseServer.from('tasks').select('id').eq('transaction_id', transactionId).eq('client_visible', true),
    ]);
    if (error) throw error;

    const { data: shareRow } = await supabaseServer
      .from('transactions')
      .select('client_share_new_documents')
      .eq('id', transactionId)
      .maybeSingle();

    return NextResponse.json({
      links: links || [],
      visibleTaskIds: (visible || []).map((t) => t.id as string),
      shareNewDocuments: shareRow?.client_share_new_documents === true,
    });
  } catch (error) {
    return handleError(error, 'load client links');
  }
}

// POST { clientName?, clientEmail?, note?, visibleTaskIds? }: create a
// progress link and, when an email is given, send it to the client.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const user = await loadAgentContext(request, transactionId);

    const body = await request.json().catch(() => ({}));
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim().slice(0, 100) : '';
    const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim().toLowerCase() : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';

    if (clientEmail && !isEmail(clientEmail)) {
      return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
    }
    if (!clientName && !clientEmail) {
      return NextResponse.json({ error: 'Add your client’s name or email.' }, { status: 400 });
    }

    if (clientEmail) {
      const allowed = await checkRateLimit(`agent-client-share:${user.id}`, 20, 60 * 60);
      if (!allowed) {
        return NextResponse.json({ error: 'You have shared a lot of links in the last hour. Please try again later.' }, { status: 429 });
      }
      const { data: existing } = await supabaseServer
        .from('external_access_links')
        .select('id, expires_at')
        .eq('transaction_id', transactionId)
        .eq('scope', 'progress')
        .eq('client_email', clientEmail)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .limit(1);
      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: 'This client already has an active link on this deal. Use Resend on their row instead.' },
          { status: 400 }
        );
      }
    }

    // The steps a client sees are per deal. Only touch them when the agent
    // actually sent a list (first share, or the picker was opened).
    if (Array.isArray(body.visibleTaskIds)) {
      await setVisibleSteps(transactionId, body.visibleTaskIds);
    }
    if (Array.isArray(body.visibleDocumentIds)) {
      await setVisibleDocuments(transactionId, body.visibleDocumentIds);
    }
    if (typeof body.shareNewDocuments === 'boolean') {
      await setShareNewDocuments(transactionId, body.shareNewDocuments);
    }

    const token = generateExternalAccessToken();
    const expiresAt = new Date(Date.now() + PROGRESS_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: link, error } = await supabaseServer
      .from('external_access_links')
      .insert({
        transaction_id: transactionId,
        created_by: user.id,
        token,
        scope: 'progress',
        recipient_label: clientEmail || clientName || null,
        client_name: clientName || null,
        client_email: clientEmail || null,
        client_note: note || null,
        expires_at: expiresAt,
      })
      .select(LINK_COLUMNS)
      .single();
    if (error) throw error;

    let emailSent = false;
    if (clientEmail) {
      emailSent = await emailLink(request, user, transactionId, {
        clientName,
        clientEmail,
        note,
        token,
      });
    }

    return NextResponse.json({ link, emailSent });
  } catch (error) {
    return handleError(error, 'share progress');
  }
}

// PATCH { visibleTaskIds?, visibleDocumentIds? }: change which checklist steps and documents clients see.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    await loadAgentContext(request, transactionId);
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.visibleTaskIds) && !Array.isArray(body.visibleDocumentIds) && typeof body.shareNewDocuments !== 'boolean') {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    if (typeof body.shareNewDocuments === 'boolean') {
      await setShareNewDocuments(transactionId, body.shareNewDocuments);
    }
    const taskIds = Array.isArray(body.visibleTaskIds) ? await setVisibleSteps(transactionId, body.visibleTaskIds) : undefined;
    const documentIds = Array.isArray(body.visibleDocumentIds)
      ? await setVisibleDocuments(transactionId, body.visibleDocumentIds)
      : undefined;
    return NextResponse.json({
      success: true,
      visibleTaskIds: taskIds,
      visibleDocumentIds: documentIds,
      shareNewDocuments: typeof body.shareNewDocuments === 'boolean' ? body.shareNewDocuments : undefined,
    });
  } catch (error) {
    return handleError(error, 'update steps');
  }
}

// "Share new documents I upload automatically" -- read by POST /api/documents for agent uploads.
async function setShareNewDocuments(transactionId: string, value: boolean) {
  const { error } = await supabaseServer.from('transactions').update({ client_share_new_documents: value }).eq('id', transactionId);
  if (error) throw error;
}

// Documents default to hidden; only ids that belong to this deal can be ticked.
async function setVisibleDocuments(transactionId: string, raw: unknown[]): Promise<string[]> {
  const ids = raw.filter((v): v is string => typeof v === 'string').slice(0, 500);
  const { error: clearError } = await supabaseServer
    .from('documents')
    .update({ client_visible: false })
    .eq('transaction_id', transactionId);
  if (clearError) throw clearError;
  if (ids.length > 0) {
    const { error } = await supabaseServer
      .from('documents')
      .update({ client_visible: true })
      .eq('transaction_id', transactionId)
      .in('id', ids);
    if (error) throw error;
  }
  return ids;
}

async function setVisibleSteps(transactionId: string, raw: unknown[]): Promise<string[]> {
  const ids = raw.filter((v): v is string => typeof v === 'string').slice(0, 200);
  const { error: clearError } = await supabaseServer
    .from('tasks')
    .update({ client_visible: false })
    .eq('transaction_id', transactionId);
  if (clearError) throw clearError;
  if (ids.length > 0) {
    const { error } = await supabaseServer
      .from('tasks')
      .update({ client_visible: true })
      .eq('transaction_id', transactionId)
      .in('id', ids);
    if (error) throw error;
  }
  return ids;
}
