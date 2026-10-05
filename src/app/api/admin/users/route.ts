import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { DEFAULT_PLAN } from '@/lib/plans';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { getTrialStatus } from '@/lib/trial';
import { getUserPlan, isPlatformAdmin } from '@/lib/privileged';

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
      .select('agent_id, amount_owed, paid, refunded_amount');

    if (invoicesError) throw invoicesError;

    // Subscription status per user, in one query rather than N -- same
    // batch-then-group pattern as agents/transactions/invoices above.
    const { data: stripeCustomers, error: stripeError } = await supabaseServer
      .from('stripe_customers')
      .select('user_id, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end');
    if (stripeError) throw stripeError;

    const stripeByUser = new Map<string, { subscription_status: string | null; stripe_customer_id: string; stripe_subscription_id: string | null; current_period_end: string | null }>();
    (stripeCustomers || []).forEach((row) => {
      stripeByUser.set(row.user_id, row);
    });

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

    (invoices || []).forEach((inv: { agent_id: string; amount_owed: number; paid: boolean; refunded_amount: number | null }) => {
      if (!inv.paid) return;
      const tcUserId = tcUserByAgentId.get(inv.agent_id);
      if (!tcUserId) return;
      // Net of any refund -- a refunded payment isn't actually "revenue
      // collected" anymore, even though the invoice itself stays marked
      // paid (see charge.refunded handling in the Connect webhook).
      ensureStats(tcUserId).revenueCollected += (inv.amount_owed || 0) - (inv.refunded_amount || 0);
    });

    // getTrialStatus is async (it may check invoices for the
    // first-paid-deal condition), so resolve every Starter user's trial
    // state up front with Promise.all rather than awaiting inside a
    // non-async .map() callback, which would silently return unresolved
    // Promises instead of the actual status.
    const trialEntries = await Promise.all(
      usersData.users
        .filter((u) => ((getUserPlan(u) as string | undefined) || DEFAULT_PLAN) === 'starter')
        .map(async (u) => [u.id, await getTrialStatus(u.id, u.created_at)] as const)
    );
    const trialByUser = new Map(trialEntries);

    const users = usersData.users.map((u) => {
      const stats = statsByTcUser.get(u.id);
      const plan = (getUserPlan(u) as string | undefined) || DEFAULT_PLAN;
      const stripeRow = stripeByUser.get(u.id) || null;
      const trial = trialByUser.get(u.id) || null;
      // banned_until in the far future (we set it to ~100 years) means
      // "suspended indefinitely"; a real expiring ban is rare here since
      // nothing else sets one, but check the date rather than assuming.
      const bannedUntil = (u as unknown as { banned_until?: string | null }).banned_until || null;
      const suspended = !!bannedUntil && new Date(bannedUntil) > new Date();

      return {
        id: u.id,
        email: u.email,
        is_admin: isPlatformAdmin(u),
        plan,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        suspended,
        trial: trial
          ? { applies: trial.applies, expired: trial.expired, trialEndsAt: trial.trialEndsAt }
          : null,
        subscription_status: stripeRow?.subscription_status || null,
        stripe_customer_id: stripeRow?.stripe_customer_id || null,
        stripe_subscription_id: stripeRow?.stripe_subscription_id || null,
        current_period_end: stripeRow?.current_period_end || null,
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
