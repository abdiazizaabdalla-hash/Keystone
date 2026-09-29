import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';

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

    const { error } = await createAuthClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: typeof redirectTo === 'string' ? redirectTo : undefined,
    });

    // Rate-limit errors etc. are worth surfacing; anything that would
    // reveal account existence is not a concern here since Supabase
    // itself doesn't distinguish "no such user" from success.
    if (error) {
      console.error('Error requesting password reset:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ status: 'sent' });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
  }
}
