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

    let query = supabaseServer
      .from('transactions')
      .select('*');

    // If not admin, only show transactions for their agents
    if (!isAdmin) {
      query = query.in(
        'agent_id',
        (await supabaseServer
          .from('agents')
          .select('id')
          .eq('tc_user_id', user.id)).data?.map((a) => a.id) || []
      );
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch transactions';
    return NextResponse.json(
      { error: message },
      { status: message.includes('Unauthorized') || message.includes('Missing') ? 401 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json();
    const { agentId, fileNumber, propertyAddress, purchasePrice } = body;

    // Verify agent belongs to user
    const { data: agent } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('tc_user_id', user.id)
      .single();

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found or does not belong to you' },
        { status: 403 }
      );
    }

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
    const message = error instanceof Error ? error.message : 'Failed to create transaction';
    return NextResponse.json(
      { error: message },
      { status: message.includes('Unauthorized') || message.includes('Missing') ? 401 : 500 }
    );
  }
}
