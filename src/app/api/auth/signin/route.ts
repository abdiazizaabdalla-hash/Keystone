import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { applyPendingTeamInvite } from '@/lib/teamInvites';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Two buckets: per-IP catches someone hammering many accounts from
    // one machine, per-email catches someone brute-forcing one account
    // from rotating IPs. Either tripping is enough to reject -- a real
    // person mistyping their own password a few times in a row never
    // gets close to either limit.
    const ip = getClientIp(request);
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(`signin:ip:${ip}`, 15, 5 * 60),
      checkRateLimit(`signin:email:${email.toLowerCase()}`, 8, 5 * 60),
    ]);
    if (!ipOk || !emailOk) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const { data, error } = await createAuthClient().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Pick up a Team invite that couldn't be applied at signup because the
    // email wasn't confirmed yet. Non-fatal.
    try {
      await applyPendingTeamInvite(data.user);
    } catch (inviteError) {
      console.error('Error applying team invite at sign-in:', inviteError);
    }

    return NextResponse.json({
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    console.error('Sign in error:', error);
    return NextResponse.json(
      { error: 'Sign in failed' },
      { status: 500 }
    );
  }
}
