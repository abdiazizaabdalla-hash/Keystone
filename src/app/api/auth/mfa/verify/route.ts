import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { challengeAndVerify, findVerifiedTotpFactor, MfaError } from '@/lib/mfa';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';

// POST { code }: the second step of sign-in. Called with the password-only
// (aal1) session from /api/auth/signin; returns the upgraded aal2 session.
// This is the one route that accepts an aal1 token.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request, { allowAal1: true });
    const token = request.headers.get('authorization')!.substring(7);
    const { code } = await request.json().catch(() => ({}));

    const factor = await findVerifiedTotpFactor(user);
    if (!factor) {
      return NextResponse.json({ error: 'Two-step sign-in is not set up for this account.' }, { status: 400 });
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
    }
    // A 6-digit code is guessable by brute force, so this is tight.
    if (!(await checkRateLimit(`mfa-verify:${user.id}`, 6, 10 * 60))) {
      await logAudit(request, user, 'auth.mfa_rate_limited', { entityType: 'user', entityId: user.id });
      return NextResponse.json({ error: 'Too many attempts. Wait a few minutes and sign in again.' }, { status: 429 });
    }

    let session;
    try {
      session = await challengeAndVerify(token, factor.id, code.trim());
    } catch (verifyError) {
      await logAudit(request, user, 'auth.mfa_failed', { entityType: 'user', entityId: user.id });
      if (verifyError instanceof MfaError && verifyError.status < 500) {
        return NextResponse.json({ error: 'That code didn\'t work. Check your app and try again.' }, { status: 400 });
      }
      throw verifyError;
    }

    await logAudit(request, user, 'auth.signin_mfa', { entityType: 'user', entityId: user.id });
    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof AuthError || error instanceof MfaError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MFA verify error:', error);
    return NextResponse.json({ error: 'Could not verify the code' }, { status: 500 });
  }
}
