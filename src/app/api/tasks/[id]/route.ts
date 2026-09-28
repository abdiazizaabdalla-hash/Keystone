import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { computeDueDates, normalizeDueDateSpec } from '@/lib/dueDates';

/**
 * Edits a single task's own due date -- the per-step override a TC reaches
 * from the "Edit" button next to a task's due date on the transaction page
 * (dashboard/transactions/[id]/page.tsx), independent of whatever the
 * account's due-date workflow or checklist template would otherwise set.
 * Unlike /api/tasks (which only toggles `completed`), this never touches
 * status or the checklist-to-status sync.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: taskId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();

    if (!body || typeof body !== 'object' || !('dueDate' in body)) {
      return NextResponse.json({ error: 'dueDate is required' }, { status: 400 });
    }

    const { data: task, error: getError } = await supabaseServer
      .from('tasks')
      .select('id, transaction_id')
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

    const dueDate = normalizeDueDateSpec(body.dueDate);
    const [computedDueDate] = computeDueDates(
      [{ name: '', dueDate }],
      transaction.acceptance_date,
      transaction.closing_date
    );

    const { data: updatedTask, error: updateError } = await supabaseServer
      .from('tasks')
      .update({
        due_date_spec: dueDate,
        due_date: computedDueDate,
        due_days_after_acceptance: dueDate.mode === 'after_acceptance' ? dueDate.days ?? null : null,
      })
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
