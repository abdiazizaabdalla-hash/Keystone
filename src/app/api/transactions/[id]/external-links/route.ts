import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';
import { generateExternalAccessToken, EXTERNAL_LINK_EXPIRY_DAYS } from '@/lib/externalAccess';

// Confirms the caller may manage external-access links on this
// transaction. Read (GET) is team-visible, same as signing_requests'
// GET; create (POST) is owner-only, same as signing_requests' POST --
// sending out a new link to a third party stays a direct-owner action,
// not something every teammate should be able to do on someone else's
// deal.
async function loadTransactionForAccess(
  transactionId: string,
  userId: string,
  isAdmin: boolean,
  readOnly: boolean
): Promise<{ id: string; agent_id: string } | null> {
  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('id, agent_id')
    .eq('id', transactionId)
    .single();
  if (!transaction) return null;
  if (isAdmin) return transaction;

  const ownerIds = readOnly ? await getVisibleTcUserIds(userId) : [userId];
  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', transaction.agent_id)
    .in('tc_user_id', ownerIds)
    .single();
  return agent ? transaction : null;
}

// GET /api/transactions/[id]/external-links -- every external-access
// link (active or expired/revoked) for this transaction, for the TC's
// own list. Never exposes the full token here beyond what's needed to
// rebuild the share link, since this list itself requires auth.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id: transactionId } = await params;

    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not available on the agent portal' }, { status: 403 });
    }

    const transaction = await loadTransactionForAccess(transactionId, user.id, isAdmin, true);
    if (!transaction) {
      return NextResponse.json({ error: 'You do not have permission to view this' }, { status: 403 });
    }

    const { data: links, error } = await supabaseServer
      .from('external_access_links')
      .select('id, scope, document_id, recipient_label, token, expires_at, revoked_at, last_accessed_at, access_count, created_at')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const documentIds = [...new Set((links || []).map((l) => l.document_id).filter(Boolean))] as string[];
    const fileNameById = new Map<string, string>();
    if (documentIds.length > 0) {
      const { data: docs } = await supabaseServer.from('documents').select('id, file_name').in('id', documentIds);
      (docs || []).forEach((d) => fileNameById.set(d.id as string, d.file_name as string));
    }

    const withFileNames = (links || []).map((l) => ({
      ...l,
      document_file_name: l.document_id ? fileNameById.get(l.document_id as string) || null : null,
    }));

    return NextResponse.json(withFileNames);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching external links:', error);
    return NextResponse.json({ error: 'Failed to fetch external links' }, { status: 500 });
  }
}

// POST /api/transactions/[id]/external-links -- create a new magic
// link, scoped to either one document or just this deal's key dates.
// No vendor, no email automation -- generates our own opaque token and
// hands back the link for the TC to send however they like.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const { id: transactionId } = await params;

    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not available on the agent portal' }, { status: 403 });
    }

    const transaction = await loadTransactionForAccess(transactionId, user.id, isAdmin, false);
    if (!transaction) {
      return NextResponse.json({ error: 'You do not have permission to share this transaction' }, { status: 403 });
    }

    const body = await request.json();
    const { scope, documentId, recipientLabel } = body;

    if (scope !== 'document' && scope !== 'dates') {
      return NextResponse.json({ error: "scope must be 'document' or 'dates'" }, { status: 400 });
    }

    let resolvedDocumentId: string | null = null;
    if (scope === 'document') {
      if (!documentId || typeof documentId !== 'string') {
        return NextResponse.json({ error: 'documentId is required for a document link' }, { status: 400 });
      }
      const { data: doc } = await supabaseServer
        .from('documents')
        .select('id')
        .eq('id', documentId)
        .eq('transaction_id', transactionId)
        .single();
      if (!doc) {
        return NextResponse.json({ error: 'Document not found on this transaction' }, { status: 404 });
      }
      resolvedDocumentId = documentId;
    }

    const token = generateExternalAccessToken();
    const expiresAt = new Date(Date.now() + EXTERNAL_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const label = typeof recipientLabel === 'string' ? recipientLabel.trim().slice(0, 200) : null;

    const { data: link, error } = await supabaseServer
      .from('external_access_links')
      .insert({
        transaction_id: transactionId,
        created_by: user.id,
        token,
        scope,
        document_id: resolvedDocumentId,
        recipient_label: label || null,
        expires_at: expiresAt,
      })
      .select('id, scope, document_id, recipient_label, token, expires_at, revoked_at, last_accessed_at, access_count, created_at')
      .single();

    if (error) throw error;
    return NextResponse.json(link);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    }
    console.error('Error creating external link:', error);
    return NextResponse.json({ error: 'Failed to create external link' }, { status: 500 });
  }
}
