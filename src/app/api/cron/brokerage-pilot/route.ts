import { NextRequest, NextResponse } from 'next/server';
import { brokerageOn } from '@/lib/oversight';
import { runPilotLifecycle } from '@/lib/brokerageAccount';

/**
 * Daily: tells brokerage owners their complimentary pilot ends in 14, 7 and 3 days and on the day, and moves pilots whose date has
 * come to pilot_expired (nothing is deleted). Call with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!brokerageOn()) return NextResponse.json({ checked: 0, reason: 'brokerage feature is off' });
  try {
    return NextResponse.json(await runPilotLifecycle(new Date().toISOString().slice(0, 10)));
  } catch (error) {
    console.error('brokerage-pilot failed:', error);
    return NextResponse.json({ error: 'Failed to run the pilot job' }, { status: 500 });
  }
}
