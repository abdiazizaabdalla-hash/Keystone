import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { exchangeCodeForTokens, getGoogleUserEmail } from '@/lib/googleCalendar';
import { verifyOAuthState } from '@/lib/oauthState';
import { encryptSecret } from '@/lib/encryption';
import { queueBackfillUserCalendar } from '@/lib/calendarSync';

// Where Google's consent screen sends the user back to. A plain browser
// redirect with no Authorization header, so the user is identified via the
// signed `state` param (see lib/oauthState.ts) instead of a session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const stateToken = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const state = stateToken ? verifyOAuthState(stateToken) : null;
  const finalPage =
    state?.from === 'onboarding' ? '/onboarding' : state?.from === 'agent' ? '/agent/settings' : '/dashboard/settings';

  if (oauthError || !code || !state) {
    return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=error`);
  }

  try {
    const redirectUri = `${origin}/api/google-calendar/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      // Google only returns a refresh_token on the first consent for a
      // client+user pair; prompt=consent forces that on every attempt, but a
      // grant made outside this flow could still land here without one.
      return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=no_refresh_token`);
    }

    const email = await getGoogleUserEmail(tokens.access_token);

    const { error: upsertError } = await supabaseServer.from('calendar_connections').upsert(
      {
        tc_user_id: state.userId, // column name is historical: any Relay user id (TC or agent)
        provider: 'google',
        refresh_token: encryptSecret(tokens.refresh_token),
        google_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tc_user_id,provider' }
    );

    if (upsertError) throw upsertError;

    // Put the dates that already exist on their calendar (runs after this redirect is sent).
    queueBackfillUserCalendar(state.userId);

    return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=connected`);
  } catch (error) {
    console.error('Error completing Google Calendar connection:', error);
    return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=error`);
  }
}
