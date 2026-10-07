import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { unenrollFactor, MfaError } from '@/lib/mfa';
import { mergeAppMetadata } from '@/lib/privileged';
import { logAudit } from '@/lib/audit';

// POST: turn two-step sign-in off. Requires an aal2 session (the strict
// getUserFromRequest guarantees the caller just proved the authenticator).
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const token = request.headers.get('authorization')!.substring(7);

    for (const f of user.factors || []) {
      await unenrollFactor(token, f.id);
    }
    await mergeAppMetadata(user.id, { mfa_enabled: false });
    await logAudit(request, user, 'auth.mfa_disabled', { entityType: 'user', entityId: user.id });
    return NextResponse.json({ enabled: false });
  } catch (error) {
    if (error instanceof AuthError || error instanceof MfaError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MFA disable error:', error);
    return NextResponse.json({ error: 'Could not turn off two-step sign-in' }, { status: 500 });
  }
}
