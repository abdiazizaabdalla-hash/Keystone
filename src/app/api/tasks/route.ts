import { NextRequest, NextResponse } from 'next/server';
import { loadTasks, saveTasks, createTasks, toggleTask, getTasksByTransaction } from '@/lib/storage';

export async function GET(request: NextRequest) {
  try {
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    
    if (transactionId) {
      const tasks = getTasksByTransaction(transactionId);
      return NextResponse.json(tasks);
    }
    
    const tasks = loadTasks();
    return NextResponse.json(tasks);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionId, taskNames } = body;

    const tasks = createTasks(transactionId, taskNames);
    return NextResponse.json(tasks, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create tasks' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId } = body;

    toggleTask(taskId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to toggle task' }, { status: 500 });
  }
}
