import { NextRequest, NextResponse } from 'next/server';
import { brokerageOn } from '@/lib/oversight';
import { runBrokerageDigest } from '@/lib/brokerageDigest';

/**
 * Monday morning email to each brokerage owner: a line per agent with open deals, what is late and what closes this week.
 * Call with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!brokerageOn()) return NextResponse.json({ sent: 0, reason: 'brokerage feature is off' });
  try {
    return NextResponse.json(await runBrokerageDigest(new Date().toISOString().slice(0, 10)));
  } catch (error) {
    console.error('brokerage-digest failed:', error);
    return NextResponse.json({ error: 'Failed to send the brokerage digest' }, { status: 500 });
  }
}
