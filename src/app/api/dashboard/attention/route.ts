import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getVisibleTcUserIds } from '@/lib/team';

/**
 * Powers the "Needs Attention Today" panel at the top of the dashboard
 * (dashboard/page.tsx) -- a single cross-transaction triage view instead
 * of having to open each deal to see what's overdue, what's due soon,
 * what's stuck waiting on someone, and what's closing soon.
 *
 * Read-only, so (unlike the task-editing routes) this never calls
 * assertTrialActive -- a TC whose trial lapsed should still be able to
 * see what's going on, just not edit anything.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);

    let txQuery = supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, closing_date, agent_id')
      .neq('status', 'Closed');

    if (!isAdmin) {
      const visibleIds = await getVisibleTcUserIds(user.id);
      const { data: userAgents } = await supabaseServer
        .from('agents')
        .select('id')
        .in('tc_user_id', visibleIds);

      const agentIds = userAgents?.map((a) => a.id as string) || [];
      if (agentIds.length === 0) {
        return NextResponse.json({
          overdue: [],
          dueToday: [],
          dueSoon: [],
          waitingOn: [],
          closingsSoon: [],
          totalNeedsAttention: 0,
        });
      }
      txQuery = txQuery.in('agent_id', agentIds);
    }

    const { data: transactions, error: txError } = await txQuery;
    if (txError) throw txError;

    if (!transactions || transactions.length === 0) {
      return NextResponse.json({
        overdue: [],
        dueToday: [],
        dueSoon: [],
        waitingOn: [],
        closingsSoon: [],
        totalNeedsAttention: 0,
      });
    }

    const txIds = transactions.map((t) => t.id as string);
    const labelByTxId = new Map(
      transactions.map((t) => [t.id as string, `${t.file_number} · ${t.property_address}`])
    );

    const { data: tasks, error: tasksError } = await supabaseServer
      .from('tasks')
      .select('id, name, due_date, transaction_id, waiting_on, waiting_on_since')
      .in('transaction_id', txIds)
      .eq('completed', false);

    if (tasksError) throw tasksError;

    const todayStr = new Date().toISOString().split('T')[0];
    const msPerDay = 24 * 60 * 60 * 1000;
    const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
    const dayDiff = (dateStr: string) =>
      Math.round((new Date(`${dateStr}T00:00:00Z`).getTime() - todayMs) / msPerDay);

    interface OverdueItem {
      taskId: string;
      taskName: string;
      transactionId: string;
      label: string;
      daysOverdue: number;
    }
    interface DueItem {
      taskId: string;
      taskName: string;
      transactionId: string;
      label: string;
    }
    interface DueSoonItem extends DueItem {
      dueInDays: number;
    }
    interface WaitingOnItem extends DueItem {
      waitingOn: string;
      daysSince: number;
    }

    const overdue: OverdueItem[] = [];
    const dueToday: DueItem[] = [];
    const dueSoon: DueSoonItem[] = [];
    const waitingOn: WaitingOnItem[] = [];

    for (const task of tasks || []) {
      const label = labelByTxId.get(task.transaction_id as string) || 'Unknown deal';
      const taskId = task.id as string;
      const taskName = task.name as string;
      const transactionId = task.transaction_id as string;

      const dueDate = task.due_date as string | null;
      if (dueDate) {
        const diff = dayDiff(dueDate);
        if (diff < 0) {
          overdue.push({ taskId, taskName, transactionId, label, daysOverdue: -diff });
        } else if (diff === 0) {
          dueToday.push({ taskId, taskName, transactionId, label });
        } else if (diff <= 3) {
          dueSoon.push({ taskId, taskName, transactionId, label, dueInDays: diff });
        }
      }

      const waitingOnValue = task.waiting_on as string | null;
      if (waitingOnValue) {
        const since = task.waiting_on_since as string | null;
        const daysSince = since ? Math.max(0, -dayDiff(since)) : 0;
        waitingOn.push({ taskId, taskName, transactionId, label, waitingOn: waitingOnValue, daysSince });
      }
    }

    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    dueSoon.sort((a, b) => a.dueInDays - b.dueInDays);
    waitingOn.sort((a, b) => b.daysSince - a.daysSince);

    const closingsSoon = transactions
      .filter((t) => {
        if (!t.closing_date) return false;
        const diff = dayDiff(t.closing_date as string);
        return diff >= 0 && diff <= 7;
      })
      .map((t) => ({
        transactionId: t.id as string,
        label: labelByTxId.get(t.id as string) || 'Unknown deal',
        closingDate: t.closing_date as string,
        daysUntil: dayDiff(t.closing_date as string),
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil);

    return NextResponse.json({
      overdue,
      dueToday,
      dueSoon,
      waitingOn,
      closingsSoon,
      // What actually needs action today -- overdue, due today, and
      // anything stuck waiting on someone. "Due soon" and "closings
      // soon" are useful lookahead but deliberately excluded from this
      // count, same split as the mockup this was built from (Overdue /
      // Due Today / Waiting On vs. a separate Coming Up section).
      totalNeedsAttention: overdue.length + dueToday.length + waitingOn.length,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error building attention summary:', error);
    return NextResponse.json({ error: 'Failed to load attention summary' }, { status: 500 });
  }
}
