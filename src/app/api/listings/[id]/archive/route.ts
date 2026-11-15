import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { cleanArchiveInput } from '@/lib/archive';
import { logAudit } from '@/lib/audit';
import { queueListingCalendarSync, removeListingCalendarEvents } from '@/lib/calendarSync';
import { logListingActivity, requireListingAccess } from '@/lib/listings';

// Archive a listing that did not go anywhere, with a reason, and restore it again. Nothing is deleted: the checklist, offers,
// documents and notes stay as they were. To leave open work (lists, calendar, reminders, attention) everywhere at once, the
// listing is set to Withdrawn and remembers the status it had; restoring puts that status back. Automatic-email drafts still
// waiting for approval are cancelled so nothing goes out later.

const MISSING = 'The database needs one more update before archiving works. Run add-listing-archive.sql in Supabase.';
const OPEN_AUTOMATION_STATES = ['proposed', 'awaiting_approval', 'approved', 'deferred'];

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  const info = error as { code?: string } | null;
  if (info && (info.code === '42703' || info.code === 'PGRST204')) return NextResponse.json({ error: MISSING }, { status: 500 });
  console.error(`Error trying to ${what}:`, error);
  return NextResponse.json({ error: `Could not ${what}` }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing, shared, coordinated } = await requireListingAccess(request, id);
    if (shared || coordinated) return NextResponse.json({ error: 'You do not have permission to archive this listing' }, { status: 403 });
    await assertTrialActive(user);
    if (listing.archived_at) return NextResponse.json({ error: 'This listing is already archived' }, { status: 400 });
    if (listing.status === 'converted') return NextResponse.json({ error: 'This listing is now a transaction. Archive the transaction instead.' }, { status: 400 });

    const input = cleanArchiveInput(await request.json().catch(() => ({})));
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

    const archivedAt = new Date().toISOString();
    const { error } = await supabaseServer
      .from('listings')
      .update({
        archived_at: archivedAt,
        archive_reason: input.reason,
        archive_note: input.note,
        archived_by: user.id,
        archive_prev_status: listing.status,
        status: 'withdrawn',
        updated_at: archivedAt,
      })
      .eq('id', id);
    if (error) throw error;

    const { error: cancelError } = await supabaseServer
      .from('automation_actions')
      .update({ status: 'cancelled' })
      .eq('listing_id', id)
      .in('status', OPEN_AUTOMATION_STATES);
    if (cancelError) console.error('Could not cancel open automation drafts for an archived listing (non-fatal):', cancelError);

    await removeListingCalendarEvents(id).catch(() => undefined);
    await logListingActivity(id, user, 'Archived the listing').catch(() => undefined);
    await logAudit(request, user, 'listing.archive', { entityType: 'listing', entityId: id, metadata: { reason: input.reason, note: input.note } });
    return NextResponse.json({ id, archived_at: archivedAt, archive_reason: input.reason, archive_note: input.note, status: 'withdrawn' });
  } catch (error) {
    return fail(error, 'archive this listing');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing, shared, coordinated } = await requireListingAccess(request, id);
    if (shared || coordinated) return NextResponse.json({ error: 'You do not have permission to restore this listing' }, { status: 403 });
    await assertTrialActive(user);
    if (!listing.archived_at) return NextResponse.json({ error: 'This listing is not archived' }, { status: 400 });

    const prev = typeof listing.archive_prev_status === 'string' && ['preparing', 'active', 'under_offer'].includes(listing.archive_prev_status) ? listing.archive_prev_status : 'preparing';
    const { error } = await supabaseServer
      .from('listings')
      .update({ archived_at: null, archive_reason: null, archive_note: null, archived_by: null, archive_prev_status: null, status: prev, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    queueListingCalendarSync(id);
    await logListingActivity(id, user, 'Restored the listing from the archive').catch(() => undefined);
    await logAudit(request, user, 'listing.unarchive', { entityType: 'listing', entityId: id });
    return NextResponse.json({ id, archived_at: null, status: prev });
  } catch (error) {
    return fail(error, 'restore this listing');
  }
}
