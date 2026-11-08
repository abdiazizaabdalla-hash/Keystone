import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { generateTeamReport } from '@/lib/teamReportStore';
import { scheduledPeriod } from '@/lib/teamReportPeriods';

/**
 * Saves the most recent complete week or month for every team owner who turned scheduled reports on, with their standing
 * notes. Safe to run daily: a unique index means each period is saved once.
 * Call with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends it).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseServer.from('team_report_settings').select('owner_user_id, team_id, cadence, notes').in('cadence', ['weekly', 'monthly']);
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ created: 0, reason: 'team report tables not created yet' });
      throw error;
    }
    let created = 0;
    let failed = 0;
    for (const s of data || []) {
      try {
        const { data: team } = await supabaseServer.from('teams').select('name').eq('id', s.team_id).maybeSingle();
        const report = await generateTeamReport({ ownerId: s.owner_user_id, teamId: s.team_id, teamName: (team?.name as string) || '', cadence: s.cadence as 'weekly' | 'monthly', period: scheduledPeriod(s.cadence as 'weekly' | 'monthly', today), notes: s.notes, today });
        if (report) created += 1;
      } catch (err) {
        failed += 1;
        console.error('team-reports: failed for', s.owner_user_id, err);
      }
    }
    return NextResponse.json({ created, failed });
  } catch (error) {
    console.error('team-reports cron failed:', error);
    return NextResponse.json({ error: 'Failed to create team reports' }, { status: 500 });
  }
}
