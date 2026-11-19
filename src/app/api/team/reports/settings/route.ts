import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser } from '@/lib/team';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { logAudit } from '@/lib/audit';

// Team owner only: how often a report is saved automatically, and the standing notes that go in every report's Notes tab.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') return NextResponse.json({ error: 'Only the team owner can manage team reports.' }, { status: 403 });
    const { data, error } = await supabaseServer.from('team_report_settings').select('cadence, notes').eq('owner_user_id', user.id).maybeSingle();
    if (error && error.code !== '42P01') throw error;
    return NextResponse.json({ cadence: data?.cadence || 'off', notes: data?.notes || '', setupNeeded: error?.code === '42P01' });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('team report settings failed:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertNotCollaborator(user);
    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') return NextResponse.json({ error: 'Only the team owner can manage team reports.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (!['off', 'weekly', 'monthly'].includes(body.cadence)) return NextResponse.json({ error: 'Choose off, weekly or monthly.' }, { status: 400 });
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : '';
    const { error } = await supabaseServer.from('team_report_settings').upsert({ owner_user_id: user.id, team_id: membership.team.id, cadence: body.cadence, notes: notes || null, updated_at: new Date().toISOString() }, { onConflict: 'owner_user_id' });
    if (error) throw error;
    await logAudit(request, user, 'team.report_settings', { entityType: 'team', entityId: membership.team.id, metadata: { cadence: body.cadence } });
    return NextResponse.json({ cadence: body.cadence, notes });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('team report settings save failed:', error);
    return NextResponse.json({ error: 'Failed to save. If this is new, run add-team-reports.sql first.' }, { status: 500 });
  }
}
