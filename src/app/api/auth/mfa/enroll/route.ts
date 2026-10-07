import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { enrollTotp, unenrollFactor, MfaError } from '@/lib/mfa';
import { checkRateLimit } from '@/lib/rateLimit';

// POST: start setting up an authenticator app. Returns the QR code (SVG data
// URI) and the manual-entry secret. Nothing is turned on until the user
// proves it works by entering a code at /api/auth/mfa/activate.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const token = request.headers.get('authorization')!.substring(7);

    if ((user.factors || []).some((f) => f.status === 'verified')) {
      return NextResponse.json({ error: 'Two-step sign-in is already on for this account.' }, { status: 409 });
    }
    if (!(await checkRateLimit(`mfa-enroll:${user.id}`, 10, 60 * 60))) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    // Clear out any abandoned, never-verified setup attempts first.
    for (const f of user.factors || []) {
      if (f.status !== 'verified') {
        await unenrollFactor(token, f.id).catch(() => undefined);
      }
    }

    const factor = await enrollTotp(token, `Relay TC ${new Date().toISOString().slice(0, 10)}`);
    return NextResponse.json({
      factorId: factor.id,
      qrCode: factor.totp.qr_code,
      secret: factor.totp.secret,
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof MfaError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MFA enroll error:', error);
    return NextResponse.json({ error: 'Could not start two-step setup' }, { status: 500 });
  }
}
