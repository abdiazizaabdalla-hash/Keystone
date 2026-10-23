import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { removeAllCalendarEventsForUser } from '@/lib/calendarSync';

export const maxDuration = 60;

// Disconnects the signed-in user's Google Calendar: deletes the stored
// (encrypted) token and the record of which events Relay created for them, so
// syncing stops immediately.
//
// By default the events already on their calendar are left alone. With
// { removeEvents: true } Relay first deletes every event IT created (only the
// ones whose ids it recorded -- never anything else on the calendar), then
// disconnects. If some deletions fail, the connection is kept so they can try
// again. They can also revoke Relay's access from their Google Account at any time.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    let removeEvents = false;
    try {
      const body = await request.json();
      removeEvents = body?.removeEvents === true;
    } catch {
      // no body = plain disconnect
    }

    let removed = 0;
    if (removeEvents) {
      const result = await removeAllCalendarEventsForUser(user.id);
      removed = result.removed;
      if (result.failed > 0) {
        return NextResponse.json(
          { error: `Removed ${result.removed} events but ${result.failed} could not be removed. You are still connected — try again in a minute.` },
          { status: 502 }
        );
      }
    }

    const { error } = await supabaseServer
      .from('calendar_connections')
      .delete()
      .eq('tc_user_id', user.id)
      .eq('provider', 'google');
    if (error) throw error;

    await supabaseServer.from('key_date_calendar_events').delete().eq('user_id', user.id);
    await supabaseServer.from('listing_agent_calendar_events').delete().eq('user_id', user.id); // ignored if the table is not there yet
    await supabaseServer.from('transaction_closing_events').delete().eq('user_id', user.id); // ignored if the table is not there yet

    return NextResponse.json({ success: true, removed });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error disconnecting Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to disconnect Google Calendar' }, { status: 500 });
  }
}
