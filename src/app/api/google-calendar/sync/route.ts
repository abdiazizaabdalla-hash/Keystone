import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { decryptSecret } from '@/lib/encryption';
import { refreshAccessToken, createCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar';
import { backfillUserCalendar } from '@/lib/calendarSync';

// POST: "Sync now". Checks the connection really works (creates and removes a throwaway event, so a
// missing permission shows up as a plain message), runs the same back-fill that runs after connecting,
// and reports how many of the person's dates are on Google Calendar and why any are not.
export const maxDuration = 60;

const today = () => new Date().toISOString().split('T')[0];

async function countEvents(userId: string, txIds: string[], listingIds: string[]) {
  const [kd, tasks, ld] = await Promise.all([
    supabaseServer.from('key_date_calendar_events').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    txIds.length
      ? supabaseServer.from('tasks').select('*', { count: 'exact', head: true }).in('transaction_id', txIds).not('google_event_id', 'is', null)
      : Promise.resolve({ count: 0 }),
    listingIds.length
      ? supabaseServer.from('listing_dates').select('*', { count: 'exact', head: true }).in('listing_id', listingIds).not('google_event_id', 'is', null)
      : Promise.resolve({ count: 0 }),
  ]);
  return (kd.count ?? 0) + (tasks.count ?? 0) + (ld.count ?? 0);
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const { data: connection } = await supabaseServer
      .from('calendar_connections')
      .select('refresh_token')
      .eq('tc_user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle();
    if (!connection) {
      return NextResponse.json({ ok: false, message: 'Google Calendar is not connected. Click Connect Google Calendar first.' });
    }

    // 1) Does Google let Relay write to this calendar?
    let accessToken: string;
    try {
      accessToken = (await refreshAccessToken(decryptSecret(connection.refresh_token as string))).accessToken;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error('Calendar sync-now: token refresh failed:', text);
      return NextResponse.json({
        ok: false,
        message: text.includes('invalid_grant')
          ? 'Google no longer accepts this connection. Disconnect, then connect again.'
          : 'Relay could not get access from Google. Disconnect, then connect again.',
      });
    }
    try {
      const probe = await createCalendarEvent(accessToken, { summary: 'Relay TC connection check', dueDate: today() });
      await deleteCalendarEvent(accessToken, probe);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error('Calendar sync-now: Google refused a test event:', text);
      return NextResponse.json({
        ok: false,
        message: text.includes('403')
          ? 'Google did not give Relay permission to add events. Disconnect, then connect again and tick “View and edit events on all your calendars”.'
          : 'Google would not accept an event from Relay. Try again in a minute.',
      });
    }

    // 2) What does this person have that could go on a calendar?
    const [{ data: tx }, { data: listings }] = await Promise.all([
      supabaseServer.from('transactions').select('id').eq('tc_user_id', user.id).limit(300),
      supabaseServer.from('listings').select('id').eq('tc_user_id', user.id).limit(300),
    ]);
    const txIds = (tx || []).map((t) => t.id as string);
    const listingIds = (listings || []).map((l) => l.id as string);
    const now = today();
    const [kd, tk, ld] = await Promise.all([
      txIds.length
        ? supabaseServer.from('transaction_key_dates').select('*', { count: 'exact', head: true }).in('transaction_id', txIds).or('completed.is.null,completed.eq.false').gte('due_date', now)
        : Promise.resolve({ count: 0 }),
      txIds.length
        ? supabaseServer.from('tasks').select('*', { count: 'exact', head: true }).in('transaction_id', txIds).or('completed.is.null,completed.eq.false').not('due_date', 'is', null)
        : Promise.resolve({ count: 0 }),
      listingIds.length
        ? supabaseServer.from('listing_dates').select('*', { count: 'exact', head: true }).in('listing_id', listingIds).gte('due_date', now)
        : Promise.resolve({ count: 0 }),
    ]);
    const candidates = (kd.count ?? 0) + (tk.count ?? 0) + (ld.count ?? 0);

    // 3) Send them.
    await backfillUserCalendar(user.id);
    const onCalendar = await countEvents(user.id, txIds, listingIds);

    let message: string;
    if (candidates === 0) {
      message = 'Connected and working, but none of your deals or listings has an upcoming date yet. Add a critical date to a deal (+ Add a date) and it will appear on your calendar within a minute.';
    } else if (onCalendar === 0) {
      message = `Connected, and you have ${candidates} upcoming date${candidates === 1 ? '' : 's'}, but none reached your calendar. Check “What goes on my calendar” below and make sure those types are ticked.`;
    } else {
      message = `${onCalendar} date${onCalendar === 1 ? '' : 's'} on your Google Calendar. Refresh Google Calendar to see ${onCalendar === 1 ? 'it' : 'them'}.`;
    }
    return NextResponse.json({ ok: true, candidates, onCalendar, message });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error syncing Google Calendar now:', error);
    return NextResponse.json({ ok: false, message: 'Something went wrong while syncing. Please try again.' });
  }
}
