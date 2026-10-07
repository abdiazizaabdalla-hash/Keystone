import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { challengeAndVerify, MfaError } from '@/lib/mfa';
import { mergeAppMetadata } from '@/lib/privileged';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';

// POST { factorId, code }: confirms the authenticator app by checking a code,
// which turns two-step sign-in on. Returns the upgraded session so the
// browser keeps working without signing in again.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const token = request.headers.get('authorization')!.substring(7);
    const { factorId, code } = await request.json().catch(() => ({}));

    if (typeof factorId !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
    }
    if (!(user.factors || []).some((f) => f.id === factorId)) {
      return NextResponse.json({ error: 'Unknown setup attempt. Start again.' }, { status: 400 });
    }
    if (!(await checkRateLimit(`mfa-activate:${user.id}`, 8, 10 * 60))) {
      return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
    }

    const session = await challengeAndVerify(token, factorId, code.trim());
    await mergeAppMetadata(user.id, { mfa_enabled: true });
    await logAudit(request, user, 'auth.mfa_enabled', { entityType: 'user', entityId: user.id });

    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof AuthError || error instanceof MfaError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MFA activate error:', error);
    return NextResponse.json({ error: 'Could not turn on two-step sign-in' }, { status: 500 });
  }
}
