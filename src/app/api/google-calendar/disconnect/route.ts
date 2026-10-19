import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// Disconnects the signed-in user's Google Calendar: deletes the stored
// (encrypted) token and the record of which events Relay created for them, so
// syncing stops immediately. The events already on their calendar are left
// alone (the privacy policy tells users to remove them in Google Calendar),
// and they can revoke Relay's access from their Google Account at any time.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const { error } = await supabaseServer
      .from('calendar_connections')
      .delete()
      .eq('tc_user_id', user.id)
      .eq('provider', 'google');
    if (error) throw error;

    await supabaseServer.from('key_date_calendar_events').delete().eq('user_id', user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error disconnecting Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to disconnect Google Calendar' }, { status: 500 });
  }
}
