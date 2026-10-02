import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { computeDueDates, normalizeDueDateSpec } from '@/lib/dueDates';

/**
 * Edits a single task's own due date and/or its "Waiting On" field -- the
 * per-step overrides a TC reaches from the "Edit" affordances next to each
 * task on the transaction page (dashboard/transactions/[id]/page.tsx),
 * independent of whatever the account's due-date workflow or checklist
 * template would otherwise set. Body may include either or both of
 * `dueDate` and `waitingOn`. Unlike /api/tasks (which only toggles
 * `completed`), this never touches status or the checklist-to-status sync.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();

    const hasDueDate = Boolean(body && typeof body === 'object' && 'dueDate' in body);
    const hasWaitingOn = Boolean(body && typeof body === 'object' && 'waitingOn' in body);

    if (!hasDueDate && !hasWaitingOn) {
      return NextResponse.json({ error: 'dueDate or waitingOn is required' }, { status: 400 });
    }

    const { data: task, error: getError } = await supabaseServer
      .from('tasks')
      .select('id, transaction_id, waiting_on')
      .eq('id', taskId)
      .single();

    if (getError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, agent_id, acceptance_date, closing_date')
      .eq('id', task.transaction_id)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .eq('tc_user_id', user.id)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to update this task' }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = {};

    if (hasDueDate) {
      const dueDate = normalizeDueDateSpec(body.dueDate);
      const [computedDueDate] = computeDueDates(
        [{ name: '', dueDate }],
        transaction.acceptance_date,
        transaction.closing_date
      );
      updates.due_date_spec = dueDate;
      updates.due_date = computedDueDate;
      updates.due_days_after_acceptance = dueDate.mode === 'after_acceptance' ? dueDate.days ?? null : null;
    }

    if (hasWaitingOn) {
      const waitingOnRaw = typeof body.waitingOn === 'string' ? body.waitingOn.trim().slice(0, 100) : null;
      const waitingOn = waitingOnRaw || null;
      updates.waiting_on = waitingOn;
      // Only stamp a fresh "since" date the moment waiting_on goes from
      // empty to set, and clear it when waiting_on is cleared -- editing
      // the text of an existing "waiting on X" doesn't reset the clock
      // on how long it's actually been stuck.
      if (waitingOn && !task.waiting_on) {
        updates.waiting_on_since = new Date().toISOString().slice(0, 10);
      } else if (!waitingOn) {
        updates.waiting_on_since = null;
      }
    }

    const { data: updatedTask, error: updateError } = await supabaseServer
      .from('tasks')
      .update(updates)
      .eq('id', taskId)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json(updatedTask);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error updating task due date:', error);
    return NextResponse.json({ error: 'Failed to update task due date' }, { status: 500 });
  }
}
