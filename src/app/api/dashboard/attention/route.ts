import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getVisibleTcUserIds, getTeamForUser } from '@/lib/team';
import { computeAttentionSummary } from '@/lib/attentionSummary';

/**
 * Powers the "Needs Attention Today" panel at the top of the dashboard
 * (dashboard/page.tsx) -- a single cross-transaction triage view instead
 * of having to open each deal to see what's overdue, what's due soon,
 * what's stuck waiting on someone, and what's closing soon.
 *
 * For a team/brokerage owner this already rolls up the whole team (via
 * getVisibleTcUserIds); tcLabel is attached per item so the owner's view
 * can show whose deal each item belongs to, not just the file number.
 *
 * Read-only, so (unlike the task-editing routes) this never calls
 * assertTrialActive -- a TC whose trial lapsed should still be able to
 * see what's going on, just not edit anything.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);

    let tcUserIds: string[];
    if (isAdmin) {
      // Platform admin (is_admin -- a completely different concept from
      // a brokerage owner) sees every open transaction, so pull the
      // distinct set of real tc_user_ids with open deals instead of
      // guessing at who those are from the full auth user list.
      const { data: allOpenTx } = await supabaseServer
        .from('transactions')
        .select('tc_user_id')
        .neq('status', 'Closed')
        .not('tc_user_id', 'is', null);
      tcUserIds = Array.from(new Set((allOpenTx || []).map((t) => t.tc_user_id as string)));
    } else {
      tcUserIds = await getVisibleTcUserIds(user.id);
    }

    const summary = await computeAttentionSummary(tcUserIds);

    // Only a team/brokerage owner has more than one id in tcUserIds --
    // resolve labels just for those, so a solo TC's request (by far the
    // common case) skips the extra admin API round-trips entirely.
    const membership = await getTeamForUser(user.id);
    const isOwner = membership?.role === 'owner' && !isAdmin;
    const tcLabels = new Map<string, string>();
    if (isOwner) {
      const distinctIds = new Set<string>();
      for (const item of [...summary.overdue, ...summary.dueToday, ...summary.dueSoon, ...summary.waitingOn, ...summary.closingsSoon]) {
        distinctIds.add(item.tcUserId);
      }
      await Promise.all(
        Array.from(distinctIds).map(async (id) => {
          const { data } = await supabaseServer.auth.admin.getUserById(id);
          const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Unknown';
          tcLabels.set(id, label);
        })
      );
    }

    const withLabel = <T extends { tcUserId: string }>(item: T) => ({
      ...item,
      tcLabel: isOwner ? tcLabels.get(item.tcUserId) || null : null,
    });

    return NextResponse.json({
      overdue: summary.overdue.map(withLabel),
      dueToday: summary.dueToday.map(withLabel),
      dueSoon: summary.dueSoon.map(withLabel),
      waitingOn: summary.waitingOn.map(withLabel),
      closingsSoon: summary.closingsSoon.map(withLabel),
      totalNeedsAttention: summary.totalNeedsAttention,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error building attention summary:', error);
    return NextResponse.json({ error: 'Failed to load attention summary' }, { status: 500 });
  }
}
