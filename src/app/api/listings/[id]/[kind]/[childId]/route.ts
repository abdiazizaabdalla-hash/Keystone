import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { queueListingCalendarSync, removeListingEvent } from '@/lib/calendarSync';
import { CHILD_TABLE, cleanChild, isChildKind } from '@/lib/listingChildren';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing item:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string; childId: string }> }) {
  try {
    const { id, kind, childId } = await params;
    if (!isChildKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const cleaned = cleanChild(kind, body, listing as { planned_list_date: string | null }, true);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });
    if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    const { data, error } = await supabaseServer
      .from(CHILD_TABLE[kind])
      .update(cleaned.value)
      .eq('id', childId)
      .eq('listing_id', id) // the child must belong to THIS listing
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const row = data as Record<string, unknown>;
    if (kind === 'tasks' && 'completed' in cleaned.value) {
      await logListingActivity(id, user, `${cleaned.value.completed ? 'Completed' : 'Reopened'}: ${row.name}`);
    } else if (kind === 'offers' && 'status' in cleaned.value) {
      await logListingActivity(id, user, `Offer${row.buyer_name ? ` from ${row.buyer_name}` : ''} marked ${cleaned.value.status}`);
    }
    if (kind === 'tasks' || kind === 'dates') queueListingCalendarSync(id);
    return NextResponse.json(data);
  } catch (error) {
    return fail(error, 'update');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string; childId: string }> }) {
  try {
    const { id, kind, childId } = await params;
    if (!isChildKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    // Remove the Google event first; once the row is gone its event id is too.
    const table = CHILD_TABLE[kind];
    if (kind === 'tasks' || kind === 'dates') {
      const { data: gone } = await supabaseServer.from(table).select('google_event_id').eq('id', childId).eq('listing_id', id).maybeSingle();
      const eventId = (gone as { google_event_id?: string | null } | null)?.google_event_id;
      if (eventId) await removeListingEvent(id, eventId);
    }
    const { error } = await supabaseServer.from(table).delete().eq('id', childId).eq('listing_id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'delete');
  }
}
