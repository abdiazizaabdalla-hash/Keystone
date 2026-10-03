import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser, getTeamMemberUserIds } from '@/lib/team';

// PATCH /api/team/unassigned/[id]  { tcUserId }
//
// Claims an unassigned transaction (see GET /api/team/unassigned) for a
// specific TC on the owner's team. Only ever moves tc_user_id from null
// to a real team member -- an already-assigned transaction is reassigned
// through PATCH /api/team/[userId]/transactions instead, which requires
// knowing its *current* assignee rather than "none yet".
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    const { tcUserId } = await request.json();

    if (!tcUserId || typeof tcUserId !== 'string') {
      return NextResponse.json({ error: 'tcUserId is required' }, { status: 400 });
    }

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can assign from the unassigned queue' }, { status: 403 });
    }

    const memberIds = await getTeamMemberUserIds(membership.team.id);
    if (!memberIds.includes(tcUserId)) {
      return NextResponse.json({ error: 'That person is not on your team' }, { status: 400 });
    }

    // Confirm this transaction is actually in this team's unassigned
    // queue (still null, and its agent belongs to this team) before
    // claiming it -- same scoping as the GET above.
    const { data: existing } = await supabaseServer
      .from('transactions')
      .select('id, tc_user_id, agent_id')
      .eq('id', id)
      .single();

    if (!existing || existing.tc_user_id !== null) {
      return NextResponse.json({ error: 'That transaction is no longer unassigned' }, { status: 409 });
    }

    const { data: agent } = await supabaseServer
      .from('agents')
      .select('tc_user_id')
      .eq('id', existing.agent_id)
      .single();
    if (!agent || !memberIds.includes(agent.tc_user_id as string)) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // The .is('tc_user_id', null) guard makes the claim atomic against a
    // second owner (or a double click) assigning the same transaction a
    // moment later -- whichever request's UPDATE actually matches a row
    // wins, the other gets back no row and a clean 409.
    const { data: updated, error } = await supabaseServer
      .from('transactions')
      .update({ tc_user_id: tcUserId })
      .eq('id', id)
      .is('tc_user_id', null)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: 'That transaction was just claimed by someone else' }, { status: 409 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error assigning unassigned transaction:', error);
    return NextResponse.json({ error: 'Failed to assign transaction' }, { status: 500 });
  }
}
