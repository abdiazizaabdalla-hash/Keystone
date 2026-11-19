import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isCollaboratorOnly } from '@/lib/agentPortal';
import { authorizeDeal } from '@/lib/authorize';
import { cleanArchiveInput } from '@/lib/archive';
import { logAudit } from '@/lib/audit';

// Archive a transaction that did not close, with a reason, and restore it again. Nothing is deleted: the checklist, documents,
// messages and invoices stay exactly as they were. While archived, the deal drops out of open work (lists, calendar, reminders,
// attention and automations); drafts of automatic emails still waiting for approval are cancelled so nothing goes out later.

const MISSING = 'The database needs one more update before archiving works. Run add-transaction-archive.sql in Supabase.';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  const info = error as { code?: string } | null;
  if (info && (info.code === '42703' || info.code === 'PGRST204')) return NextResponse.json({ error: MISSING }, { status: 500 });
  console.error(`Error trying to ${what}:`, error);
  return NextResponse.json({ error: `Could not ${what}` }, { status: 500 });
}

const OPEN_AUTOMATION_STATES = ['proposed', 'awaiting_approval', 'approved', 'deferred'];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isCollaboratorOnly(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);
    const { id } = await params;
    await authorizeDeal(user, isAdmin, id, { scope: 'team', participants: 'full', collaborators: false, deniedMessage: 'You do not have permission to archive this transaction' });

    const input = cleanArchiveInput(await request.json().catch(() => ({})));
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

    const archivedAt = new Date().toISOString();
    const { error } = await supabaseServer
      .from('transactions')
      .update({ archived_at: archivedAt, archive_reason: input.reason, archive_note: input.note, archived_by: user.id, updated_at: archivedAt })
      .eq('id', id);
    if (error) throw error;

    // Drafts that were waiting for approval would otherwise pop up for a deal that is no longer being worked.
    const { error: cancelError } = await supabaseServer
      .from('automation_actions')
      .update({ status: 'cancelled' })
      .eq('transaction_id', id)
      .in('status', OPEN_AUTOMATION_STATES);
    if (cancelError) console.error('Could not cancel open automation drafts for an archived deal (non-fatal):', cancelError);

    await logAudit(request, user, 'transaction.archive', { entityType: 'transaction', entityId: id, metadata: { reason: input.reason, note: input.note } });
    return NextResponse.json({ id, archived_at: archivedAt, archive_reason: input.reason, archive_note: input.note });
  } catch (error) {
    return fail(error, 'archive this transaction');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isCollaboratorOnly(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);
    const { id } = await params;
    await authorizeDeal(user, isAdmin, id, { scope: 'team', participants: 'full', collaborators: false, deniedMessage: 'You do not have permission to restore this transaction' });
    const { error } = await supabaseServer
      .from('transactions')
      .update({ archived_at: null, archive_reason: null, archive_note: null, archived_by: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await logAudit(request, user, 'transaction.unarchive', { entityType: 'transaction', entityId: id });
    return NextResponse.json({ id, archived_at: null });
  } catch (error) {
    return fail(error, 'restore this transaction');
  }
}
