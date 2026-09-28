import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// Disconnects the signed-in TC's Google Calendar. Just deletes our own
// row -- we don't call Google's token-revocation endpoint, since letting
// the stored refresh_token quietly expire on its own is simpler and the
// TC can always revoke Relay's access directly from their Google Account
// permissions page if they want it gone immediately.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const { error } = await supabaseServer
      .from('calendar_connections')
      .delete()
      .eq('tc_user_id', user.id)
      .eq('provider', 'google');

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error disconnecting Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to disconnect Google Calendar' }, { status: 500 });
  }
}
