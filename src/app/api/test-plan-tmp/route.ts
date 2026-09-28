import { NextRequest, NextResponse } from 'next/server';
import { setUserPlan } from '@/lib/stripeCustomers';

// TEMPORARY verification-only route. Delete once you're done exploring
// the Starter plan -- not part of the app.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId')!;
  const plan = searchParams.get('plan') as 'starter' | 'pro' | 'team';
  try {
    await setUserPlan(userId, plan);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
