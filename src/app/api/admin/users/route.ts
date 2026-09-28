import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { DEFAULT_PLAN } from '@/lib/plans';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';

const CLOSED_STATUS = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1]; // 'Closed'

export async function GET(request: NextRequest) {
  try {
    const { isAdmin } = await getUserFromRequest(request);

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: usersData, error: usersError } = await supabaseServer.auth.admin.listUsers();
    if (usersError) throw usersError;

    // Every agent profile, transaction, and invoice in one go, then group
    // in memory by tc_user_id -- far fewer round trips than a per-user
    // query, and this route only ever runs for the handful of admins who
    // load this page.
    const { data: agents, error: agentsError } = await supabaseServer
      .from('agents')
      .select('id, tc_user_id');

    if (agentsError) throw agentsError;

    const agentIdsByTcUser = new Map<string, string[]>();
    const tcUserByAgentId = new Map<string, string>();
    (agents || []).forEach((a: { id: string; tc_user_id: string }) => {
      tcUserByAgentId.set(a.id, a.tc_user_id);
      const list = agentIdsByTcUser.get(a.tc_user_id) || [];
      list.push(a.id);
      agentIdsByTcUser.set(a.tc_user_id, list);
    });

    const { data: transactions, error: transactionsError } = await supabaseServer
      .from('transactions')
      .select('agent_id, status');

    if (transactionsError) throw transactionsError;

    const { data: invoices, error: invoicesError } = await supabaseServer
      .from('invoices')
      .select('agent_id, amount_owed, paid');

    if (invoicesError) throw invoicesError;

    const statsByTcUser = new Map<
      string,
      { activeTransactions: number; closedTransactions: number; revenueCollected: number }
    >();
    const ensureStats = (tcUserId: string) => {
      let stats = statsByTcUser.get(tcUserId);
      if (!stats) {
        stats = { activeTransactions: 0, closedTransactions: 0, revenueCollected: 0 };
        statsByTcUser.set(tcUserId, stats);
      }
      return stats;
    };

    (transactions || []).forEach((t: { agent_id: string; status: string }) => {
      const tcUserId = tcUserByAgentId.get(t.agent_id);
      if (!tcUserId) return;
      const stats = ensureStats(tcUserId);
      if (t.status === CLOSED_STATUS) stats.closedTransactions += 1;
      else stats.activeTransactions += 1;
    });

    (invoices || []).forEach((inv: { agent_id: string; amount_owed: number; paid: boolean }) => {
      if (!inv.paid) return;
      const tcUserId = tcUserByAgentId.get(inv.agent_id);
      if (!tcUserId) return;
      ensureStats(tcUserId).revenueCollected += inv.amount_owed || 0;
    });

    const users = usersData.users.map((u) => {
      const stats = statsByTcUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        is_admin: u.user_metadata?.is_admin === true,
        plan: (u.user_metadata?.plan as string | undefined) || DEFAULT_PLAN,
        created_at: u.created_at,
        agents_count: (agentIdsByTcUser.get(u.id) || []).length,
        active_transactions: stats?.activeTransactions || 0,
        closed_transactions: stats?.closedTransactions || 0,
        revenue_collected: stats?.revenueCollected || 0,
      };
    });

    return NextResponse.json(users);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
