import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization token');
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !user) {
    throw new Error('Unauthorized');
  }

  // Check if admin
  const { data: userData } = await supabaseServer.auth.admin.getUserById(user.id);
  const isAdmin = userData?.user_metadata?.is_admin === true;

  return { user, isAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (transactionId) {
      let query = supabaseServer
        .from('tasks')
        .select('*')
        .eq('transaction_id', transactionId)
        .order('created_at', { ascending: true });

      if (!isAdmin) {
        // Verify transaction belongs to user's agent
        const { data: transaction } = await supabaseServer
          .from('transactions')
          .select('agent_id')
          .eq('id', transactionId)
          .single();

        if (transaction) {
          const { data: agent } = await supabaseServer
            .from('agents')
            .select('id')
            .eq('id', transaction.agent_id)
            .eq('tc_user_id', user.id)
            .single();

          if (!agent) {
            return NextResponse.json(
              { error: 'You do not have permission to view these tasks' },
              { status: 403 }
            );
          }
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data);
    }

    // Get all tasks for user's transactions
    let query = supabaseServer
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: true });

    if (!isAdmin) {
      // Only get tasks for transactions of user's agents
      const { data: userAgents } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('tc_user_id', user.id);

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
    console.error('Error fetching tasks:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch tasks';
    return NextResponse.json(
      { error: message },
      { status: message.includes('Unauthorized') || message.includes('Missing') ? 401 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const body = await request.json();
    const { taskId } = body;

    // Get current task with transaction
    const { data: task, error: getError } = await supabaseServer
      .from('tasks')
      .select('completed, transaction_id')
      .eq('id', taskId)
      .single();

    if (getError) throw getError;

    // Verify permission if not admin
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
          return NextResponse.json(
            { error: 'You do not have permission to update this task' },
            { status: 403 }
          );
        }
      }
    }

    // Toggle completed
    const { error: updateError } = await supabaseServer
      .from('tasks')
      .update({ completed: !task.completed })
      .eq('id', taskId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error toggling task:', error);
    const message = error instanceof Error ? error.message : 'Failed to toggle task';
    return NextResponse.json(
      { error: message },
      { status: message.includes('Unauthorized') || message.includes('Missing') ? 401 : 500 }
    );
  }
}
