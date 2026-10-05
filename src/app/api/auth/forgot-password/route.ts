import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { sameOriginRedirect } from '@/lib/teamInvites';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// Starts a password reset: Supabase emails a recovery link (via the
// Resend SMTP relay already configured in Supabase Auth settings) that
// lands on /auth/reset-password with a short-lived recovery session in
// the URL hash. That page is what actually sets the new password.
//
// Always returns 200 regardless of whether the email has an account --
// returning a different response for "no such account" would let anyone
// probe which emails are registered. Supabase's resetPasswordForEmail
// already behaves this way itself (it only errors on things like rate
// limiting, never "not found").
export async function POST(request: NextRequest) {
  try {
    const { email, redirectTo } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Blocking by request count alone (not by whether the account
    // exists) keeps the "never reveal account existence" property
    // intact -- this rejects the 4th attempt at the same email the same
    // way whether or not that email has an account. Supabase's own SMTP
    // settings already cap how often ANY email address gets sent to
    // (once/minute), but this also stops someone hammering many
    // different addresses from one IP to spam a bunch of inboxes at
    // once.
    const ip = getClientIp(request);
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(`forgot-password:ip:${ip}`, 8, 10 * 60),
      checkRateLimit(`forgot-password:email:${email.trim().toLowerCase()}`, 3, 10 * 60),
    ]);
    if (!ipOk || !emailOk) {
      return NextResponse.json(
        { error: 'Too many reset attempts. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const { error } = await createAuthClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: sameOriginRedirect(redirectTo, request.nextUrl.origin),
    });

    // Rate-limit errors etc. are worth surfacing; anything that would
    // reveal account existence is not a concern here since Supabase
    // itself doesn't distinguish "no such user" from success.
    if (error) {
      console.error('Error requesting password reset:', error);
      return NextResponse.json({ error: 'Could not send the reset email. Please try again in a minute.' }, { status: 400 });
    }

    return NextResponse.json({ status: 'sent' });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
  }
}
