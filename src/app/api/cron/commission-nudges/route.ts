import { NextRequest, NextResponse } from 'next/server';
import { brokerageOn } from '@/lib/oversight';
import { runCommissionNudges } from '@/lib/commissionNudges';

/**
 * Daily follow-ups between agents and their brokerage: an invoice waiting too long for approval, a deal about to close or already
 * closed with no commission invoice, an approved commission still unpaid. Bell notifications only; each is repeated no more
 * often than its own interval. Call with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!brokerageOn()) return NextResponse.json({ created: 0, reason: 'brokerage feature is off' });
  try {
    return NextResponse.json(await runCommissionNudges(new Date().toISOString().slice(0, 10)));
  } catch (error) {
    console.error('commission-nudges failed:', error);
    return NextResponse.json({ error: 'Failed to run the commission nudges' }, { status: 500 });
  }
}
