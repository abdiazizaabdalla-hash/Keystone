import { supabaseServer } from '@/lib/supabase';
import { buildTeamReportData, type TeamReportData } from '@/lib/teamReport';
import { periodLabel, type ReportPeriod } from '@/lib/teamReportPeriods';

export interface SavedReport {
  id: string;
  cadence: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  notes: string | null;
}

/** Builds a report for a period and saves the snapshot. Returns null when a scheduled report for that period already exists. */
export async function generateTeamReport(opts: { ownerId: string; teamId: string; teamName: string; cadence: 'manual' | 'weekly' | 'monthly'; period: ReportPeriod; notes: string | null; today: string }): Promise<SavedReport | null> {
  const data = await buildTeamReportData({ ownerId: opts.ownerId, teamId: opts.teamId, teamName: opts.teamName, periodStart: opts.period.start, periodEnd: opts.period.end, today: opts.today });
  const { data: row, error } = await supabaseServer
    .from('team_reports')
    .insert({ owner_user_id: opts.ownerId, team_id: opts.teamId, cadence: opts.cadence, period_start: opts.period.start, period_end: opts.period.end, notes: opts.notes, data })
    .select('id, cadence, period_start, period_end, generated_at, notes')
    .single();
  if (error) {
    if (error.code === '23505') return null;
    throw error;
  }
  return row as SavedReport;
}

export const reportTitle = (r: { cadence: string; period_start: string; period_end: string }) => periodLabel(r.cadence, { start: r.period_start, end: r.period_end });
export type { TeamReportData };
