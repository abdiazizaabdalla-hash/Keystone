import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { syncTasksToStatus } from '@/lib/closeTransaction';
import { computeDueDates, normalizeDueDateSpec, dueDaysToSpec } from '@/lib/dueDates';
export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('id');
    const body = await request.json();
    const { status, acceptanceDate, closingDate } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    if (!isAdmin) {
      const { data: existingTx } = await supabaseServer
        .from('transactions')
        .select('agent_id')
        .eq('id', transactionId)
        .single();

      if (existingTx) {
        const { data: agent } = await supabaseServer
          .from('agents')
          .select('id')
          .eq('id', existingTx.agent_id)
          .eq('tc_user_id', user.id)
          .single();

        if (!agent) {
          return NextResponse.json({ error: 'You do not have permission to update this transaction' }, { status: 403 });
        }
      }
    }

    // This route handles two independent kinds of edits, either alone or
    // together in one request: a status change, and/or an edit to the
    // acceptance/closing anchor dates (see lib/dueDates.ts). Only the
    // fields actually present in the body get written.
    const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) updateFields.status = status;
    if (acceptanceDate !== undefined) updateFields.acceptance_date = acceptanceDate || null;
    if (closingDate !== undefined) updateFields.closing_date = closingDate || null;

    const { data: transaction, error: updateError } = await supabaseServer
      .from('transactions')
      .update(updateFields)
      .eq('id', transactionId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Hand back whichever rows changed so the frontend can update state
    // directly instead of re-fetching everything. Both branches can run
    // in the same request; the later one wins if both touch a task.
    let responseTasks: any[] | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any -- rows from two different supabase selects, reshaped identically at each call site

    if (status !== undefined) {
      // Keep the checklist in sync with the manually-set status: check
      // off (or reopen) tasks so the two never drift apart.
      //
      // Invoices are never generated automatically on close, on any plan
      // -- the TC always clicks "Create Invoice" themselves from the
      // transaction page once a deal is Closed (see
      // dashboard/transactions/[id]/page.tsx).
      responseTasks = await syncTasksToStatus(transactionId, status);
    }

    if (acceptanceDate !== undefined || closingDate !== undefined) {
      // Either anchor date changed -- rewrite the computed due_date
      // snapshot on every task for this transaction. computeDueDates
      // returns all-null for a custom (non-baseline) checklist template
      // or when no acceptance date is set, which is a harmless no-op
      // write in either case.
      const { data: existingTasks, error: tasksFetchError } = await supabaseServer
        .from('tasks')
        .select('id, name, due_date_spec, due_days_after_acceptance')
        .eq('transaction_id', transactionId)
        .order('sort_order', { ascending: true });

      if (tasksFetchError) throw tasksFetchError;

      if (existingTasks && existingTasks.length > 0) {
        // due_date_spec is the current source of truth; a row saved before
        // it existed only has the legacy due_days_after_acceptance column,
        // which dueDaysToSpec() converts to the same shape.
        const dueDates = computeDueDates(
          existingTasks.map((t) => ({
            name: t.name as string,
            dueDate: t.due_date_spec
              ? normalizeDueDateSpec(t.due_date_spec)
              : dueDaysToSpec(t.due_days_after_acceptance as number | null),
          })),
          transaction.acceptance_date,
          transaction.closing_date
        );

        const updatedTasks = await Promise.all(
          existingTasks.map(async (t, index) => {
            const { data: updatedTask, error: taskUpdateError } = await supabaseServer
              .from('tasks')
              .update({ due_date: dueDates[index] })
              .eq('id', t.id as string)
              .select()
              .single();
            if (taskUpdateError) throw taskUpdateError;
            return updatedTask;
          })
        );

        responseTasks = updatedTasks;
      }
    }

    return NextResponse.json({ ...transaction, tasks: responseTasks ?? undefined });
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
    console.error('Error updating transaction:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}
