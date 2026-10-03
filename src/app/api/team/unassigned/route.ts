import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser, getTeamMemberUserIds } from '@/lib/team';

// GET /api/team/unassigned
//
// The brokerage/team's "unassigned" queue: transactions created with
// tc_user_id left null on purpose (see POST /api/transactions'
// leaveUnassigned flag) because no TC has been handed the deal yet.
// Scoped to this team the same way everything else here is -- via the
// transaction's agent_id, whose owning agents.tc_user_id must be one of
// this team's members -- rather than a new team_id column on
// transactions, matching the rest of this codebase's convention of
// deriving team scope instead of duplicating it. Owner-only.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can view the unassigned queue' }, { status: 403 });
    }

    const memberIds = await getTeamMemberUserIds(membership.team.id);

    const { data: teamAgents, error: agentsError } = await supabaseServer
      .from('agents')
      .select('id, name, email, phone, brokerage')
      .in('tc_user_id', memberIds);
    if (agentsError) throw agentsError;

    const agentIds = (teamAgents || []).map((a) => a.id as string);
    if (agentIds.length === 0) {
      return NextResponse.json([]);
    }

    const agentById = new Map((teamAgents || []).map((a) => [a.id as string, a]));

    const { data: transactions, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, purchase_price, status, created_at, agent_id')
      .is('tc_user_id', null)
      .in('agent_id', agentIds)
      .order('created_at', { ascending: true });
    if (txError) throw txError;

    const result = (transactions || []).map((t) => {
      const agent = agentById.get(t.agent_id as string);
      return {
        id: t.id,
        fileNumber: t.file_number,
        propertyAddress: t.property_address,
        purchasePrice: t.purchase_price,
        status: t.status,
        createdAt: t.created_at,
        agent: agent ? { name: agent.name, email: agent.email, phone: agent.phone, brokerage: agent.brokerage } : null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching unassigned queue:', error);
    return NextResponse.json({ error: 'Failed to fetch unassigned queue' }, { status: 500 });
  }
}
