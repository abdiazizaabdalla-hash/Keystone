import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { data, error } = await supabaseServer
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, fileNumber, propertyAddress, purchasePrice } = body;

    // Create transaction
    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .insert({
        agent_id: agentId,
        file_number: fileNumber,
        property_address: propertyAddress,
        purchase_price: purchasePrice,
        status: 'Contract Pending',
      })
      .select()
      .single();

    if (txError) throw txError;

    // Auto-create tasks from template
    const taskNames = [
      'Pre-Inspection',
      'Inspection',
      'Appraisal',
      'Underwriting',
      'Funding',
      'Closing',
    ];

    const tasks = taskNames.map((name) => ({
      transaction_id: transaction.id,
      name,
      completed: false,
    }));

    const { error: tasksError } = await supabaseServer
      .from('tasks')
      .insert(tasks);

    if (tasksError) throw tasksError;

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
