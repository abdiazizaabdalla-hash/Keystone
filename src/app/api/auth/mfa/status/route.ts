import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { findVerifiedTotpFactor } from '@/lib/mfa';

// GET: is two-step sign-in on for this account, and which factor?
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const factor = await findVerifiedTotpFactor(user);
    return NextResponse.json({ enabled: Boolean(factor), factorId: factor?.id ?? null });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('MFA status error:', error);
    return NextResponse.json({ error: 'Failed to load two-step status' }, { status: 500 });
  }
}
