import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { sendDueDateReminderDigest, ReminderTransactionGroup } from '@/lib/dueDateReminders';

/**
 * Daily digest job: emails each TC a summary of checklist tasks that are
 * overdue or due today, across their open (non-Closed) deals. This is
 * the proactive half of the auto-due-date system in lib/dueDates.ts --
 * that module only computes a due_date snapshot on each task; nothing
 * previously surfaced it to anyone unless the TC happened to open the
 * transaction page and read the checklist.
 *
 * Call this on a schedule with `Authorization: Bearer ${CRON_SECRET}`.
 * vercel.json wires this to Vercel Cron, which sends that header
 * automatically when CRON_SECRET is set in the project's environment.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayStr = new Date().toISOString().split('T')[0];

  const { data: tasks, error: tasksError } = await supabaseServer
    .from('tasks')
    .select('id, name, due_date, transaction_id')
    .eq('completed', false)
    .not('due_date', 'is', null)
    .lte('due_date', todayStr);

  if (tasksError) {
    console.error('due-date-reminders: failed to load tasks', tasksError);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ notified: 0, reason: 'no tasks due' });
  }

  // Closed deals are excluded -- nothing actionable there, and status
  // syncing already checks off every task on close anyway (see
  // syncTasksToStatus in lib/closeTransaction.ts), so this should rarely
  // matter in practice.
  const transactionIds = [...new Set(tasks.map((t) => t.transaction_id as string))];
  const { data: transactions, error: txError } = await supabaseServer
    .from('transactions')
    .select('id, file_number, property_address, status, agent_id')
    .in('id', transactionIds)
    .neq('status', 'Closed');

  if (txError) {
    console.error('due-date-reminders: failed to load transactions', txError);
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }

  const openTransactionsById = new Map((transactions || []).map((t) => [t.id as string, t]));
  if (openTransactionsById.size === 0) {
    return NextResponse.json({ notified: 0, reason: 'no open transactions with due tasks' });
  }

  const agentIds = [...new Set(Array.from(openTransactionsById.values()).map((t) => t.agent_id as string))];
  const { data: agents, error: agentsError } = await supabaseServer
    .from('agents')
    .select('id, tc_user_id')
    .in('id', agentIds);

  if (agentsError) {
    console.error('due-date-reminders: failed to load agents', agentsError);
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }

  const tcUserIdByAgentId = new Map((agents || []).map((a) => [a.id as string, a.tc_user_id as string]));

  // tc_user_id -> transaction_id -> group
  const groupsByTcUser = new Map<string, Map<string, ReminderTransactionGroup>>();

  for (const task of tasks) {
    const transaction = openTransactionsById.get(task.transaction_id as string);
    if (!transaction) continue; // closed, or belongs to a transaction we excluded above
    const tcUserId = tcUserIdByAgentId.get(transaction.agent_id as string);
    if (!tcUserId) continue;

    let tcGroups = groupsByTcUser.get(tcUserId);
    if (!tcGroups) {
      tcGroups = new Map();
      groupsByTcUser.set(tcUserId, tcGroups);
    }

    let group = tcGroups.get(transaction.id as string);
    if (!group) {
      group = {
        transactionId: transaction.id as string,
        label: `${transaction.file_number} · ${transaction.property_address}`,
        overdueTasks: [],
        dueTodayTasks: [],
      };
      tcGroups.set(transaction.id as string, group);
    }

    if ((task.due_date as string) < todayStr) {
      group.overdueTasks.push(task.name as string);
    } else {
      group.dueTodayTasks.push(task.name as string);
    }
  }

  const appUrl = new URL(request.url).origin;
  let notified = 0;
  const errors: string[] = [];

  for (const [tcUserId, tcGroups] of groupsByTcUser) {
    try {
      const { data: userData, error: userError } = await supabaseServer.auth.admin.getUserById(tcUserId);
      if (userError || !userData?.user?.email) continue;

      await sendDueDateReminderDigest({
        toEmail: userData.user.email,
        appUrl,
        groups: Array.from(tcGroups.values()),
      });
      notified += 1;
    } catch (err) {
      errors.push(`${tcUserId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    notified,
    tcCount: groupsByTcUser.size,
    errors: errors.length ? errors : undefined,
  });
}
