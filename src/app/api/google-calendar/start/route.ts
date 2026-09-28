import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getGoogleAuthUrl } from '@/lib/googleCalendar';
import { signOAuthState } from '@/lib/oauthState';

// Starts the "Connect Google Calendar" flow for the signed-in TC. Returns
// a URL for the client to redirect to (same pattern as
// /api/stripe/connect/start) rather than redirecting itself, since this
// is called from an authenticated fetch, not a plain browser navigation.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const from = body?.from === 'onboarding' ? 'onboarding' : 'settings';

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
