import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { googleCalendarAvailableFor } from '@/lib/googleCalendarAccess';
import { recordAgentLoginEmail } from '@/lib/calendarSync';

// Lets the settings cards show whether Google Calendar is connected, and as
// whom, without ever handing the refresh_token itself to the client.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const { data, error } = await supabaseServer
      .from('calendar_connections')
      .select('*')
      .eq('tc_user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle();

    if (error) throw error;

    // Agents who connected before listings could sync: record their sign-in email once.
    if (data && user.app_metadata?.role === 'agent' && !(data as { login_email?: string | null }).login_email) {
      await recordAgentLoginEmail(user.id, true);
    }

    return NextResponse.json({
      connected: Boolean(data),
      email: data?.google_email || null,
      available: Boolean(data) || googleCalendarAvailableFor(user.email),
      lastSyncedAt: (data as { last_synced_at?: string | null } | null)?.last_synced_at || null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching Google Calendar status:', error);
    return NextResponse.json({ error: 'Failed to fetch Google Calendar status' }, { status: 500 });
  }
}
