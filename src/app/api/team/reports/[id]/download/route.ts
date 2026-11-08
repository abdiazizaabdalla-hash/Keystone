import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import { teamReportWorkbook, type TeamReportData } from '@/lib/teamReport';
import { reportTitle } from '@/lib/teamReportStore';

// GET /api/team/reports/[id]/download: the saved report as an Excel workbook. Team owner only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') return NextResponse.json({ error: 'Only the team owner can download team reports.' }, { status: 403 });
    const { id } = await params;
    const { data: row, error } = await supabaseServer.from('team_reports').select('id, cadence, period_start, period_end, notes, data').eq('id', id).eq('owner_user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    const buffer = await teamReportWorkbook(row.data as TeamReportData, { cadence: row.cadence, periodTitle: reportTitle(row), notes: row.notes });
    await logAudit(request, user, 'team.report_download', { entityType: 'team_report', entityId: id });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="team-report-${row.period_start}-to-${row.period_end}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('team report download failed:', error);
    return NextResponse.json({ error: 'Failed to download the report' }, { status: 500 });
  }
}
