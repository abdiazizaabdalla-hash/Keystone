import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser } from '@/lib/team';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { logAudit } from '@/lib/audit';
import { generateTeamReport, reportTitle } from '@/lib/teamReportStore';
import { cleanPeriod, lastDays, lastFullMonth, lastFullWeek } from '@/lib/teamReportPeriods';

// Team owner only. GET lists saved reports (newest period first); POST builds one now.
async function owner(request: NextRequest) {
  const { user } = await getUserFromRequest(request);
  const membership = await getTeamForUser(user.id);
  if (!membership || membership.role !== 'owner') return { user, membership: null };
  return { user, membership };
}

export async function GET(request: NextRequest) {
  try {
    const { user, membership } = await owner(request);
    if (!membership) return NextResponse.json({ error: 'Only the team owner can see team reports.' }, { status: 403 });
    const { data, error } = await supabaseServer
      .from('team_reports')
      .select('id, cadence, period_start, period_end, generated_at, notes')
      .eq('owner_user_id', user.id)
      .order('period_end', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(200);
    if (error) {
      // Table not created yet (add-team-reports.sql not run).
      if (error.code === '42P01') return NextResponse.json({ reports: [], setupNeeded: true });
      throw error;
    }
    return NextResponse.json({ reports: (data || []).map((r) => ({ ...r, title: reportTitle(r) })) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('team reports list failed:', error);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, membership } = await owner(request);
    assertNotCollaborator(user);
    if (!membership) return NextResponse.json({ error: 'Only the team owner can generate team reports.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    let period;
    let cadence: 'manual' | 'weekly' | 'monthly' = 'manual';
    switch (body.range) {
      case 'last_week': period = lastFullWeek(today); cadence = 'weekly'; break;
      case 'last_month': period = lastFullMonth(today); cadence = 'monthly'; break;
      case 'last_7': period = lastDays(today, 7); break;
      case 'last_30': period = lastDays(today, 30); break;
      case 'custom': period = cleanPeriod(body.start, body.end); break;
      default: period = null;
    }
    if (!period) return NextResponse.json({ error: 'Choose a valid date range (up to a year).' }, { status: 400 });
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 5000) : null;
    // A "last full week/month" report is the same as the scheduled one: reuse it rather than saving a duplicate.
    let report = await generateTeamReport({ ownerId: user.id, teamId: membership.team.id, teamName: membership.team.name || '', cadence, period, notes, today });
    if (!report) {
      const { data } = await supabaseServer.from('team_reports').select('id, cadence, period_start, period_end, generated_at, notes').eq('owner_user_id', user.id).eq('cadence', cadence).eq('period_start', period.start).maybeSingle();
      report = data;
    }
    if (!report) return NextResponse.json({ error: 'Failed to generate the report' }, { status: 500 });
    await logAudit(request, user, 'team.report_generated', { entityType: 'team_report', entityId: report.id, metadata: { cadence, start: period.start, end: period.end } });
    return NextResponse.json({ report: { ...report, title: reportTitle(report) } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('team report generate failed:', error);
    return NextResponse.json({ error: 'Failed to generate the report. If this is new, run add-team-reports.sql first.' }, { status: 500 });
  }
}
