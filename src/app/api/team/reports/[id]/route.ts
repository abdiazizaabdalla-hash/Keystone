import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { logAudit } from '@/lib/audit';

// PATCH: the team owner edits the notes on one saved report (they show in its Notes tab on the next download).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    assertNotCollaborator(user);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.notes !== 'string') return NextResponse.json({ error: 'Notes are required.' }, { status: 400 });
    const notes = body.notes.trim().slice(0, 5000) || null;
    const { data, error } = await supabaseServer.from('team_reports').update({ notes }).eq('id', id).eq('owner_user_id', user.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    await logAudit(request, user, 'team.report_notes', { entityType: 'team_report', entityId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('team report notes failed:', error);
    return NextResponse.json({ error: 'Failed to save notes' }, { status: 500 });
  }
}
