import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { DEFAULT_PLAN } from '@/lib/plans';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { getTrialStatus } from '@/lib/trial';
import { getUserPlan, isPlatformAdmin, hasAgentRole } from '@/lib/privileged';

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
      .select('id, tc_user_id, name, email');

    if (agentsError) throw agentsError;

    const agentProfilesByTcUser = new Map<string, { id: string; name: string | null; email: string | null }[]>();
    const agentIdsByTcUser = new Map<string, string[]>();
    const tcUserByAgentId = new Map<string, string>();
    (agents || []).forEach((a: { id: string; tc_user_id: string; name: string | null; email: string | null }) => {
      const profiles = agentProfilesByTcUser.get(a.tc_user_id) || [];
      profiles.push({ id: a.id, name: a.name, email: a.email });
      agentProfilesByTcUser.set(a.tc_user_id, profiles);
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

    // AI document reads per account (contract, listing agreement, offer package), from ai_usage
    // (add-ai-usage.sql). If that table hasn't been created yet this is just empty, not an error.
    const aiByUser = new Map<string, { total: number; last30: number; tokens: number; last: string | null }>();
    {
      const { data: aiRows, error: aiError } = await supabaseServer
        .from('ai_usage')
        .select('user_id, created_at, input_tokens, output_tokens')
        .limit(50000);
      if (aiError) {
        console.error('Admin: could not read ai_usage (has add-ai-usage.sql been run?):', aiError.message);
      } else {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        (aiRows || []).forEach((row: { user_id: string; created_at: string; input_tokens: number | null; output_tokens: number | null }) => {
          const cur = aiByUser.get(row.user_id) || { total: 0, last30: 0, tokens: 0, last: null };
          cur.total += 1;
          if (new Date(row.created_at).getTime() >= cutoff) cur.last30 += 1;
          cur.tokens += (row.input_tokens || 0) + (row.output_tokens || 0);
          if (!cur.last || row.created_at > cur.last) cur.last = row.created_at;
          aiByUser.set(row.user_id, cur);
        });
      }
    }

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
    // Agent-portal logins (people invited onto a deal as an agent) are listed
    // under the TC who invited them, not as top-level users.
    const agentAccounts = usersData.users.filter((u) => hasAgentRole(u) && !isPlatformAdmin(u));
    const tcAuthUsers = usersData.users.filter((u) => !(hasAgentRole(u) && !isPlatformAdmin(u)));

    const { data: portalLinks, error: portalError } = await supabaseServer
      .from('transaction_agents')
      .select('agent_user_id, invited_by, transaction_id');
    if (portalError) throw portalError;
    const dealsByAgentAndTc = new Map<string, Set<string>>(); // `${tc}|${agent}` -> deal ids
    const linkedAgentIds = new Set<string>();
    (portalLinks || []).forEach((l: { agent_user_id: string; invited_by: string; transaction_id: string }) => {
      const key = `${l.invited_by}|${l.agent_user_id}`;
      const set = dealsByAgentAndTc.get(key) || new Set<string>();
      set.add(l.transaction_id);
      dealsByAgentAndTc.set(key, set);
      linkedAgentIds.add(l.agent_user_id);
    });

    const agentAccountView = (u: (typeof usersData.users)[number], deals: number) => {
      const bannedUntil = (u as unknown as { banned_until?: string | null }).banned_until || null;
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        suspended: !!bannedUntil && new Date(bannedUntil) > new Date(),
        deals,
      };
    };
    const agentAccountById = new Map(agentAccounts.map((u) => [u.id, u]));
    const portalAgentsByTc = new Map<string, ReturnType<typeof agentAccountView>[]>();
    dealsByAgentAndTc.forEach((dealSet, key) => {
      const [tcId, agentId] = key.split('|');
      const account = agentAccountById.get(agentId);
      if (!account) return;
      const list = portalAgentsByTc.get(tcId) || [];
      list.push(agentAccountView(account, dealSet.size));
      portalAgentsByTc.set(tcId, list);
    });
    const unlinkedAgents = agentAccounts
      .filter((u) => !linkedAgentIds.has(u.id))
      .map((u) => agentAccountView(u, 0));

    const trialEntries = await Promise.all(
      tcAuthUsers
        .filter((u) => ((getUserPlan(u) as string | undefined) || DEFAULT_PLAN) === 'starter')
        .map(async (u) => [u.id, await getTrialStatus(u.id, u.created_at)] as const)
    );
    const trialByUser = new Map(trialEntries);

    const users = tcAuthUsers.map((u) => {
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
        agent_profiles: agentProfilesByTcUser.get(u.id) || [],
        portal_agents: portalAgentsByTc.get(u.id) || [],
        active_transactions: stats?.activeTransactions || 0,
        closed_transactions: stats?.closedTransactions || 0,
        revenue_collected: stats?.revenueCollected || 0,
        ai_reads: aiByUser.get(u.id)?.total || 0,
        ai_reads_30d: aiByUser.get(u.id)?.last30 || 0,
        ai_tokens: aiByUser.get(u.id)?.tokens || 0,
        ai_last_used: aiByUser.get(u.id)?.last || null,
      };
    });

    return NextResponse.json({ users, unlinkedAgents });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
