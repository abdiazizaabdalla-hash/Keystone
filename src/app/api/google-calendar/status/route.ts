import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// Lets Settings show whether Google Calendar is connected, and as whom,
// without ever handing the refresh_token itself to the client.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const { data, error } = await supabaseServer
      .from('calendar_connections')
      .select('google_email')
      .eq('tc_user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ connected: Boolean(data), email: data?.google_email || null });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching Google Calendar status:', error);
    return NextResponse.json({ error: 'Failed to fetch Google Calendar status' }, { status: 500 });
  }
}
