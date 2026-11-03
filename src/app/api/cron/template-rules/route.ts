import { NextRequest, NextResponse } from 'next/server';
import { isFeatureOn } from '@/lib/features';
import { evaluateAllTemplateRules } from '@/lib/templateRules';

/**
 * Makes the drafts that have come due for everyone with an enabled template rule. It only ever creates drafts
 * for approval; it sends nothing. Same auth as the other cron jobs (`Authorization: Bearer ${CRON_SECRET}`). Vercel's free plan allows only two cron jobs and both are taken, so the daily run
 * happens inside /api/cron/due-date-reminders; this route is for running it by hand.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isFeatureOn('templates')) return NextResponse.json({ skipped: 'templates are off' });
  try {
    return NextResponse.json(await evaluateAllTemplateRules());
  } catch (error) {
    console.error('template-rules cron failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
