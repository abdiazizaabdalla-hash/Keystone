import { supabaseServer } from './supabase';

// Shared core of the "Needs Attention Today" rollup -- originally just
// src/app/api/dashboard/attention/route.ts's own logic, pulled out here
// so the same overdue/due-today/waiting-on/closing-soon computation can
// also power a brokerage owner's per-TC workload breakdown (the
// Collaborate page) without duplicating the day-diff math twice.
//
// Takes the already-resolved list of tc_user_ids to include (a solo
// TC's own id, or a whole team's member ids for an owner) and queries
// transactions.tc_user_id directly (see add-brokerage-org.sql) rather
// than through agent_id -> agents.tc_user_id -- same correctness fix as
// everywhere else this indirection used to live: a transaction
// reassigned to a different TC needs to show up (and roll up) for them,
// which the old agent-based lookup never could.

export interface AttentionDueItem {
  taskId: string;
  taskName: string;
  transactionId: string;
  label: string;
  tcUserId: string;
}

export interface AttentionOverdueItem extends AttentionDueItem {
  daysOverdue: number;
}

export interface AttentionDueSoonItem extends AttentionDueItem {
  dueInDays: number;
}

export interface AttentionWaitingOnItem extends AttentionDueItem {
  waitingOn: string;
  daysSince: number;
}

export interface AttentionClosingSoonItem {
  transactionId: string;
  label: string;
  closingDate: string;
  daysUntil: number;
  tcUserId: string;
}

export interface TcWorkload {
  tcUserId: string;
  activeTransactions: number;
  overdueCount: number;
  dueTodayCount: number;
  waitingOnCount: number;
  closingSoonCount: number;
}

export interface AttentionSummary {
  overdue: AttentionOverdueItem[];
  dueToday: AttentionDueItem[];
  dueSoon: AttentionDueSoonItem[];
  waitingOn: AttentionWaitingOnItem[];
  closingsSoon: AttentionClosingSoonItem[];
  totalNeedsAttention: number;
  /** Per-TC rollup counts, one entry per id in tcUserIds (zeros if they have nothing). */
  byTc: TcWorkload[];
}

const EMPTY: AttentionSummary = {
  overdue: [],
  dueToday: [],
  dueSoon: [],
  waitingOn: [],
  closingsSoon: [],
  totalNeedsAttention: 0,
  byTc: [],
};

export async function computeAttentionSummary(tcUserIds: string[]): Promise<AttentionSummary> {
  if (tcUserIds.length === 0) return EMPTY;

  const { data: transactions, error: txError } = await supabaseServer
    .from('transactions')
    .select('id, file_number, property_address, closing_date, tc_user_id')
    .neq('status', 'Closed')
    .in('tc_user_id', tcUserIds);
  if (txError) throw txError;

  if (!transactions || transactions.length === 0) {
    return { ...EMPTY, byTc: tcUserIds.map((id) => ({ tcUserId: id, activeTransactions: 0, overdueCount: 0, dueTodayCount: 0, waitingOnCount: 0, closingSoonCount: 0 })) };
  }

  const txIds = transactions.map((t) => t.id as string);
  const labelByTxId = new Map(transactions.map((t) => [t.id as string, `${t.file_number} · ${t.property_address}`]));
  const tcByTxId = new Map(transactions.map((t) => [t.id as string, t.tc_user_id as string]));

  const { data: tasks, error: tasksError } = await supabaseServer
    .from('tasks')
    .select('id, name, due_date, transaction_id, waiting_on, waiting_on_since')
    .in('transaction_id', txIds)
    .eq('completed', false);
  if (tasksError) throw tasksError;

  const todayStr = new Date().toISOString().split('T')[0];
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const dayDiff = (dateStr: string) => Math.round((new Date(`${dateStr}T00:00:00Z`).getTime() - todayMs) / msPerDay);

  const overdue: AttentionOverdueItem[] = [];
  const dueToday: AttentionDueItem[] = [];
  const dueSoon: AttentionDueSoonItem[] = [];
  const waitingOn: AttentionWaitingOnItem[] = [];

  for (const task of tasks || []) {
    const transactionId = task.transaction_id as string;
    const label = labelByTxId.get(transactionId) || 'Unknown deal';
    const tcUserId = tcByTxId.get(transactionId) || '';
    const taskId = task.id as string;
    const taskName = task.name as string;

    const dueDate = task.due_date as string | null;
    if (dueDate) {
      const diff = dayDiff(dueDate);
      if (diff < 0) {
        overdue.push({ taskId, taskName, transactionId, label, daysOverdue: -diff, tcUserId });
      } else if (diff === 0) {
        dueToday.push({ taskId, taskName, transactionId, label, tcUserId });
      } else if (diff <= 3) {
        dueSoon.push({ taskId, taskName, transactionId, label, dueInDays: diff, tcUserId });
      }
    }

    const waitingOnValue = task.waiting_on as string | null;
    if (waitingOnValue) {
      const since = task.waiting_on_since as string | null;
      const daysSince = since ? Math.max(0, -dayDiff(since)) : 0;
      waitingOn.push({ taskId, taskName, transactionId, label, waitingOn: waitingOnValue, daysSince, tcUserId });
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
      tcUserId: t.tc_user_id as string,
    }))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const activeByTc = new Map<string, number>();
  for (const t of transactions) {
    const id = t.tc_user_id as string;
    activeByTc.set(id, (activeByTc.get(id) || 0) + 1);
  }
  const countBy = <T extends { tcUserId: string }>(items: T[], id: string) =>
    items.filter((i) => i.tcUserId === id).length;
  const byTc: TcWorkload[] = tcUserIds.map((id) => ({
    tcUserId: id,
    activeTransactions: activeByTc.get(id) || 0,
    overdueCount: countBy(overdue, id),
    dueTodayCount: countBy(dueToday, id),
    waitingOnCount: countBy(waitingOn, id),
    closingSoonCount: countBy(closingsSoon, id),
  }));

  return {
    overdue,
    dueToday,
    dueSoon,
    waitingOn,
    closingsSoon,
    // What actually needs action today -- overdue, due today, and
    // anything stuck waiting on someone. "Due soon" and "closings soon"
    // are useful lookahead but deliberately excluded from this count,
    // same split as the original mockup this was built from.
    totalNeedsAttention: overdue.length + dueToday.length + waitingOn.length,
    byTc,
  };
}
