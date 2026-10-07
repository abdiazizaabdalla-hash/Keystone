import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { applyPendingTeamInvite } from '@/lib/teamInvites';
import { logAudit } from '@/lib/audit';
import { findVerifiedTotpFactor } from '@/lib/mfa';

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
      await logAudit(request, null, 'auth.signin_rate_limited', { metadata: { email: String(email).toLowerCase() } });
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
      await logAudit(request, null, 'auth.signin_failed', { entityType: 'user', metadata: { email: String(email).toLowerCase() } });
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Pick up a Team invite that couldn't be applied at signup because the
    // email wasn't confirmed yet. Non-fatal.
    try {
      await applyPendingTeamInvite(data.user);
    } catch (inviteError) {
      console.error('Error applying team invite at sign-in:', inviteError);
    }

    await logAudit(request, data.user, 'auth.signin', { entityType: 'user', entityId: data.user.id });
    // Accounts with two-step sign-in on get only a password-level (aal1)
    // session here, which the API refuses everywhere except the MFA verify
    // route. The browser must collect the authenticator code, then trade
    // this session for a fully verified one.
    const mfaFactor = await findVerifiedTotpFactor(data.user);
    if (mfaFactor) {
      return NextResponse.json({
        mfaRequired: true,
        factorId: mfaFactor.id,
        user: data.user,
        session: data.session,
      });
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
