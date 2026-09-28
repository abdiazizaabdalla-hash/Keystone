import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { exchangeCodeForTokens, getGoogleUserEmail } from '@/lib/googleCalendar';
import { verifyOAuthState } from '@/lib/oauthState';
import { encryptSecret } from '@/lib/encryption';

// Where Google's consent screen sends the TC back to. Same shape as
// /api/stripe/connect/return: a plain browser redirect with no
// Authorization header, so the TC is identified via the signed `state`
// param (see lib/oauthState.ts) instead of a session -- `state` proves
// this really is a redirect from a flow we started, and carries which
// user started it.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const stateToken = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const state = stateToken ? verifyOAuthState(stateToken) : null;
  const finalPage = state?.from === 'onboarding' ? '/onboarding' : '/dashboard/settings';

  if (oauthError || !code || !state) {
    return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=error`);
  }

  try {
    const redirectUri = `${origin}/api/google-calendar/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      // Google only hands back a refresh_token on the very first consent
      // for this client+user pair. We force prompt=consent in
      // getGoogleAuthUrl to make every connect attempt count as "first",
      // but a user who somehow already granted access outside this flow
      // could still land here without one -- surface it clearly rather
      // than silently storing a connection that can't actually sync.
      return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=no_refresh_token`);
    }

    const email = await getGoogleUserEmail(tokens.access_token);

    const { error: upsertError } = await supabaseServer.from('calendar_connections').upsert(
      {
        tc_user_id: state.userId,
        provider: 'google',
        refresh_token: encryptSecret(tokens.refresh_token),
        google_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tc_user_id,provider' }
    );

    if (upsertError) throw upsertError;

    return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=connected`);
  } catch (error) {
    console.error('Error completing Google Calendar connection:', error);
    return NextResponse.redirect(`${origin}${finalPage}?googleCalendar=error`);
  }
}
