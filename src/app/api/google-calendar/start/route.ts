import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getGoogleAuthUrl } from '@/lib/googleCalendar';
import { googleCalendarAvailableFor } from '@/lib/googleCalendarAccess';
import { signOAuthState, type OAuthReturnTo } from '@/lib/oauthState';

// Starts the "Connect Google Calendar" flow for the signed-in user -- a TC
// (Settings) or an agent (agent portal). Returns a URL for the client to
// redirect to rather than redirecting itself, since this is called from an
// authenticated fetch, not a plain browser navigation.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!googleCalendarAvailableFor(user.email)) {
      return NextResponse.json({ error: 'Google Calendar sync is not open to everyone yet. Use the calendar link instead.' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const from: OAuthReturnTo =
      body?.from === 'onboarding' ? 'onboarding' : body?.from === 'agent' ? 'agent' : body?.from === 'calendar' ? 'calendar' : 'settings';

    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/google-calendar/callback`;
    const state = signOAuthState(user.id, from);

    return NextResponse.json({ url: getGoogleAuthUrl(redirectUri, state) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error starting Google Calendar connection:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start Google Calendar connection' },
      { status: 500 }
    );
  }
}
