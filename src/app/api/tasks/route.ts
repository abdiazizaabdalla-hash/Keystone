import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { statusFromTasks } from '@/lib/transactionStages';
import { syncTransactionTasksToCalendar } from '@/lib/calendarSync';
import { getVisibleTcUserIds } from '@/lib/team';

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (transactionId) {
      if (!isAdmin) {
        // Read access follows the same team-wide rule as
        // /api/transactions and /api/agents (see getVisibleTcUserIds): a
        // Team owner can view a teammate's checklist too, not just their
        // own. Fixed 2026-09 -- this previously only checked the
        // caller's own tc_user_id, which 403'd a team owner opening a
        // teammate's transaction.
        const { data: transaction } = await supabaseServer
          .from('transactions')
          .select('agent_id')
          .eq('id', transactionId)
          .single();

        if (transaction) {
          const visibleIds = await getVisibleTcUserIds(user.id);
          const { data: agent } = await supabaseServer
            .from('agents')
            .select('id')
            .eq('id', transaction.agent_id)
            .in('tc_user_id', visibleIds)
            .single();

          if (!agent) {
            return NextResponse.json({ error: 'You do not have permission to view these tasks' }, { status: 403 });
          }
        }
      }

      const { data, error } = await supabaseServer
        .from('tasks')
        .select('*')
        .eq('transaction_id', transactionId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return NextResponse.json(data);
    }

    let query = supabaseServer
      .from('tasks')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!isAdmin) {
      // Same team-wide read rule as above -- an owner's "all tasks"
      // view should include their whole team's, not just their own.
      const visibleIds = await getVisibleTcUserIds(user.id);
      const { data: userAgents } = await supabaseServer
        .from('agents')
        .select('id')
        .in('tc_user_id', visibleIds);

      const agentIds = userAgents?.map((a) => a.id) || [];
      if (agentIds.length === 0) {
        return NextResponse.json([]);
      }

      const { data: userTransactions } = await supabaseServer
        .from('transactions')
        .select('id')
        .in('agent_id', agentIds);

      const transactionIds = userTransactions?.map((t) => t.id) || [];
      if (transactionIds.length === 0) {
        return NextResponse.json([]);
      }

      query = query.in('transaction_id', transactionIds);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { taskId } = body;

    // Get current task
    const { data: task, error: getError } = await supabaseServer
      .from('tasks')
      .select('completed, transaction_id, name')
      .eq('id', taskId)
      .single();

    if (getError) throw getError;

    if (!isAdmin) {
      const { data: transaction } = await supabaseServer
        .from('transactions')
        .select('agent_id')
        .eq('id', task.transaction_id)
        .single();

      if (transaction) {
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
    }

    // Toggle completed
    const nowCompleted = !task.completed;
    const { error: updateError } = await supabaseServer
      .from('tasks')
      .update({ completed: nowCompleted })
      .eq('id', taskId);

    if (updateError) throw updateError;

    // Auto-advance (or roll back) the transaction status to match the
    // checklist, so the two stay in sync without a manual status change.
    // Select full rows (not just `completed`) so we can hand the final
    // task list straight back to the frontend below.
    const { data: allTasks } = await supabaseServer
      .from('tasks')
      .select('*')
      .eq('transaction_id', task.transaction_id)
      .order('sort_order', { ascending: true });

    let newStatus: string | null = null;
    if (allTasks) {
      newStatus = statusFromTasks(allTasks);

      const { data: transaction } = await supabaseServer
        .from('transactions')
        .select('id, agent_id, file_number, property_address, purchase_price, status')
        .eq('id', task.transaction_id)
        .single();

      if (transaction && transaction.status !== newStatus) {
        await supabaseServer
          .from('transactions')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', transaction.id);
        // Invoices are never generated automatically, even when the
        // checklist auto-advances a transaction to "Closed" -- the TC
        // always creates it themselves from the transaction page (see
        // dashboard/transactions/[id]/page.tsx's "Create Invoice" button).
      }

      // Toggling completion changes whether this task should still have
      // a calendar event -- resync (best-effort, no-op if this TC hasn't
      // connected a calendar; see lib/calendarSync.ts).
      if (transaction) {
        const { data: agent } = await supabaseServer
          .from('agents')
          .select('tc_user_id')
          .eq('id', transaction.agent_id)
          .single();
        if (agent?.tc_user_id) {
          await syncTransactionTasksToCalendar(
            agent.tc_user_id,
            `${transaction.file_number} · ${transaction.property_address}`,
            allTasks
          );
        }
      }
    }

    // Return the up-to-date task list too, so the frontend can update its
    // local state directly instead of re-fetching everything after a toggle.
    return NextResponse.json({ success: true, status: newStatus, tasks: allTasks || [] });
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
    console.error('Error toggling task:', error);
    return NextResponse.json({ error: 'Failed to toggle task' }, { status: 500 });
  }
}
