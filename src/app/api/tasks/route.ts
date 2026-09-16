import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (transactionId) {
      const { data, error } = await supabaseServer
        .from('tasks')
        .select('*')
        .eq('transaction_id', transactionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return NextResponse.json(data);
    }

    const { data, error } = await supabaseServer
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId } = body;

    // Get current task
    const { data: task, error: getError } = await supabaseServer
      .from('tasks')
      .select('completed')
      .eq('id', taskId)
      .single();

    if (getError) throw getError;

    // Toggle completed
    const { error: updateError } = await supabaseServer
      .from('tasks')
      .update({ completed: !task.completed })
      .eq('id', taskId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error toggling task:', error);
    return NextResponse.json({ error: 'Failed to toggle task' }, { status: 500 });
  }
}
