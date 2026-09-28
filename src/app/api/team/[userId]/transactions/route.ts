import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser, getTeamMemberUserIds } from '@/lib/team';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';

const CLOSED_STATUS = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1]; // 'Closed'

interface TransactionRow {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  created_at: string;
}

// GET /api/team/[userId]/transactions
//
// A single teammate's active + past transactions, for the team owner's
// drill-down on /dashboard/collaborate. Owner-only, and only for someone
// who is actually a member of the owner's own team -- unlike
// /api/transactions (which already scopes an owner's *own* list request
// to their whole team via getVisibleTcUserIds), this endpoint hands back
// one specific *other* person's data, so the membership check here is
// the only thing standing between a team owner and an unrelated user's
// pipeline. Deliberately read-only and summary-only (no tasks, documents,
// or invoices) -- those endpoints are still scoped to tc_user_id directly
// and would 403 for anyone but the transaction's own owner, so this route
// doesn't promise access it can't back up.
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    const { userId: targetUserId } = await params;

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: "Only the team owner can view a teammate's transactions" },
        { status: 403 }
      );
    }

    const memberIds = await getTeamMemberUserIds(membership.team.id);
    if (!memberIds.includes(targetUserId)) {
      return NextResponse.json({ error: 'That person is not on your team' }, { status: 404 });
    }

    const { data: targetUserData } = await supabaseServer.auth.admin.getUserById(targetUserId);
    const email = targetUserData.user?.email || 'unknown';
    const name =
      typeof targetUserData.user?.user_metadata?.full_name === 'string'
        ? targetUserData.user.user_metadata.full_name
        : '';

    const { data: memberAgents, error: agentsError } = await supabaseServer
      .from('agents')
      .select('id, name')
      .eq('tc_user_id', targetUserId);
    if (agentsError) throw agentsError;

    const agentIds = (memberAgents || []).map((a) => a.id as string);
    const agentNames = new Map((memberAgents || []).map((a) => [a.id as string, a.name as string]));

    let transactions: (TransactionRow & { agent_name: string })[] = [];
    if (agentIds.length > 0) {
      const { data, error } = await supabaseServer
        .from('transactions')
        .select('id, agent_id, file_number, property_address, purchase_price, status, created_at')
        .in('agent_id', agentIds)
        .order('created_at', { ascending: false });
      if (error) throw error;

      transactions = (data || []).map((t) => ({
        ...(t as TransactionRow),
        agent_name: agentNames.get((t as TransactionRow).agent_id) || 'Unknown',
      }));
    }

    return NextResponse.json({
      member: { userId: targetUserId, email, name },
      active: transactions.filter((t) => t.status !== CLOSED_STATUS),
      closed: transactions.filter((t) => t.status === CLOSED_STATUS),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching teammate's transactions:", error);
    return NextResponse.json({ error: "Failed to fetch teammate's transactions" }, { status: 500 });
  }
}
