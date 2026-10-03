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
//
// Filters on transactions.tc_user_id directly (see add-brokerage-org.sql)
// rather than through agent_id -> agents.tc_user_id, same correctness fix
// as /api/transactions -- a transaction reassigned onto this teammate (see
// PATCH below) needs to actually show up here, which the old agent-based
// lookup never could.
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

    const { data, error } = await supabaseServer
      .from('transactions')
      .select('id, agent_id, file_number, property_address, purchase_price, status, created_at')
      .eq('tc_user_id', targetUserId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = (data || []) as TransactionRow[];
    const agentIds = Array.from(new Set(rows.map((t) => t.agent_id)));
    let agentNames = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: agentRows, error: agentsError } = await supabaseServer
        .from('agents')
        .select('id, name')
        .in('id', agentIds);
      if (agentsError) throw agentsError;
      agentNames = new Map((agentRows || []).map((a) => [a.id as string, a.name as string]));
    }

    const transactions = rows.map((t) => ({ ...t, agent_name: agentNames.get(t.agent_id) || 'Unknown' }));

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

// PATCH /api/team/[userId]/transactions
//
// Reassigns one of this teammate's transactions to a different member of
// the same team. Owner-only -- this is the "Reassign" control on the
// /dashboard/collaborate drill-down. [userId] in the URL is the
// transaction's CURRENT assignee, used only to sanity-check the request
// matches what the page is showing; the actual authorization is that the
// transaction's real tc_user_id, and the requested newTcUserId, both have
// to be members of the owner's own team.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    const { userId: currentUserId } = await params;
    const body = await request.json();
    const { transactionId, newTcUserId } = body;

    if (!transactionId || !newTcUserId) {
      return NextResponse.json({ error: 'transactionId and newTcUserId are required' }, { status: 400 });
    }

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can reassign transactions' }, { status: 403 });
    }

    const memberIds = await getTeamMemberUserIds(membership.team.id);
    if (!memberIds.includes(currentUserId) || !memberIds.includes(newTcUserId)) {
      return NextResponse.json({ error: 'Both the current and new assignee must be on your team' }, { status: 404 });
    }

    const { data: existingTx, error: fetchError } = await supabaseServer
      .from('transactions')
      .select('tc_user_id')
      .eq('id', transactionId)
      .single();
    if (fetchError) throw fetchError;
    if (!existingTx || existingTx.tc_user_id !== currentUserId) {
      return NextResponse.json({ error: 'That transaction is not currently assigned to this teammate' }, { status: 409 });
    }

    const { error: updateError } = await supabaseServer
      .from('transactions')
      .update({ tc_user_id: newTcUserId, updated_at: new Date().toISOString() })
      .eq('id', transactionId);
    if (updateError) throw updateError;

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error reassigning transaction:', error);
    return NextResponse.json({ error: 'Failed to reassign transaction' }, { status: 500 });
  }
}
