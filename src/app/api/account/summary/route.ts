import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getPlan, getPlanLimits, isTeamPlan, DEFAULT_PLAN } from '@/lib/plans';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { getStripeCustomerByUserId } from '@/lib/stripeCustomers';
import { getTrialStatus } from '@/lib/trial';
import { getTeamForUser } from '@/lib/team';
import { getUserPlan } from '@/lib/privileged';

const CLOSED_STATUS = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1]; // 'Closed'

// Account page data: plan + billing management (upgrade/manage subscription)
// for everyone, plus a detailed usage overview as a Pro/Team perk. Usage
// stats are gated by plan; billing itself is not, since a Starter user
// needs this page to upgrade in the first place.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const planId = getUserPlan(user) || DEFAULT_PLAN;
    const plan = getPlan(planId);

    let usage = null;
    if (plan.limits.adminDashboard) {
      const { data: agents, error: agentsError } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('tc_user_id', user.id);

      if (agentsError) throw agentsError;

      const agentIds = (agents || []).map((a) => a.id);
      let activeTransactions = 0;
      let totalTransactions = 0;

      if (agentIds.length > 0) {
        const { count: activeCount, error: activeError } = await supabaseServer
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .in('agent_id', agentIds)
          .neq('status', CLOSED_STATUS);
        if (activeError) throw activeError;
        activeTransactions = activeCount || 0;

        const { count: totalCount, error: totalError } = await supabaseServer
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .in('agent_id', agentIds);
        if (totalError) throw totalError;
        totalTransactions = totalCount || 0;
      }

      usage = {
        agents: agentIds.length,
        maxAgents: getPlanLimits(planId).maxAgents,
        activeTransactions,
        maxActiveTransactions: getPlanLimits(planId).maxActiveTransactions,
        totalTransactions,
      };
    }

    const billing = await getStripeCustomerByUserId(user.id);

    // A Team plan member (not the owner) never has their own Stripe
    // subscription row -- the owner's does the billing. Surfaced so the
    // Billing section can say that instead of wrongly implying they're
    // still on Starter just because hasSubscription comes back false.
    let isTeamMember = false;
    if (isTeamPlan(plan.id)) {
      const membership = await getTeamForUser(user.id);
      isTeamMember = membership?.role === 'member';
    }

    // Trial info is only meaningful for Starter, and only while they don't
    // already have an active paid Starter subscription (same "already
    // paying" check assertTrialActive uses server-side) -- otherwise it's
    // just noise on the account page.
    let trial = null;
    const hasActivePaidStarter =
      billing?.plan === 'starter' &&
      !!billing.stripe_subscription_id &&
      ['active', 'trialing'].includes(billing.subscription_status || '');
    if (plan.id === 'starter' && !hasActivePaidStarter) {
      const status = await getTrialStatus(user.id, user.created_at);
      trial = {
        applies: status.applies,
        trialEndsAt: status.trialEndsAt ? status.trialEndsAt.toISOString() : null,
        expired: status.expired,
        endedBy: status.endedBy,
        daysLeft:
          status.applies && status.trialEndsAt
            ? Math.max(0, Math.ceil((status.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
            : null,
      };
    }

    return NextResponse.json({
      email: user.email,
      createdAt: user.created_at,
      plan: {
        id: plan.id,
        name: plan.name,
      },
      // null (not an error) on Starter — the detailed usage breakdown is a
      // Pro/Team perk; the frontend shows an upgrade prompt in its place.
      usage,
      billing: {
        hasSubscription: Boolean(billing?.stripe_subscription_id),
        status: billing?.subscription_status || null,
        currentPeriodEnd: billing?.current_period_end || null,
        isTeamMember,
      },
      // null when not applicable: not on Starter, grandfathered in, or
      // already paying for Starter post-trial.
      trial,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error building account summary:', error);
    return NextResponse.json({ error: 'Failed to load account summary' }, { status: 500 });
  }
}
