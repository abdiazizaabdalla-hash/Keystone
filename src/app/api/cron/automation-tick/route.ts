import { NextRequest, NextResponse } from 'next/server';
import { isFeatureOn } from '@/lib/features';
import { runTick } from '@/lib/automation/tick';

// The assistant's runner: resumes held and retried work, reacts to new events, sweeps deals that have the assistant switched on,
// and sends daily briefings. Safe to call as often as you like (every action has an idempotency key and every claim is atomic).
// Called hourly by a Supabase schedule (add-automation-schedule.sql; Vercel Hobby cannot run hourly crons) and once a day by
// Vercel as a fallback. Same auth as the other cron jobs: `Authorization: Bearer ${CRON_SECRET}`.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isFeatureOn('automation')) return NextResponse.json({ skipped: 'automation is off' });
  try {
    return NextResponse.json(await runTick());
  } catch (error) {
    console.error('automation-tick failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
