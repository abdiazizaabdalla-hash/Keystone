import { NextRequest, NextResponse } from 'next/server';
import { runAllBrokerageAutomations } from '@/lib/brokerageAutomations';

// Every morning: checks each brokerage owner's switched-on automations and tells the right people once.
// Call with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it).
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runAllBrokerageAutomations(new Date().toISOString().slice(0, 10)));
  } catch (error) {
    console.error('brokerage-automations failed:', error);
    return NextResponse.json({ error: 'Failed to run brokerage automations' }, { status: 500 });
  }
}
