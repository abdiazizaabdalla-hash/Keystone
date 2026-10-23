import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { findAgentAccount, readAgentLoginToken } from '@/lib/agentLoginToken';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// POST { token }: trades an emailed sign-in link's token for a real session. The token is signed and time-limited
// but not used up, so the link keeps working until it expires. Only an existing agent-portal account can be signed
// in this way.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';

    const ok = await checkRateLimit(`agent-session:ip:${getClientIp(request)}`, 30, 10 * 60);
    if (!ok) return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 });

    const parsed = readAgentLoginToken(token);
    if ('error' in parsed) {
      return NextResponse.json(
        { error: parsed.error === 'expired' ? 'This login link has expired. Request a new one and it will work for the next half hour.' : 'This login link is not valid. Please request a new one.' },
        { status: 400 }
      );
    }

    const account = await findAgentAccount(parsed.email);
    if (!account) {
      return NextResponse.json({ error: 'This login link is not valid. Please request a new one.' }, { status: 400 });
    }

    const { data, error } = await createAuthClient().auth.verifyOtp({ type: 'magiclink', token_hash: account.hashedToken });
    if (error || !data.session) {
      console.error('Could not start an agent session from a login link:', error);
      return NextResponse.json({ error: 'We could not log you in. Please request a new link.' }, { status: 400 });
    }

    return NextResponse.json({
      session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
      user: { id: data.session.user.id, hasPassword: data.session.user.user_metadata?.has_password === true },
    });
  } catch (error) {
    console.error('Error creating agent session from login link:', error);
    return NextResponse.json({ error: 'We could not log you in. Please request a new link.' }, { status: 500 });
  }
}
