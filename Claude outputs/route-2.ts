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
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const paidFilter = searchParams.get('paid');

    // Get user's agent IDs if not admin
    let userAgentIds: string[] = [];
    if (!isAdmin) {
      const { data: agents } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('tc_user_id', user.id);
      userAgentIds = agents?.map((a) => a.id) || [];
    }

    let query = supabaseServer
      .from('invoices')
      .select(`
        *,
        agent:agents(id, name, brokerage, commission_percent, flat_fee),
        transaction:transactions(id, file_number, property_address, purchase_price)
      `)
      .order('invoice_date', { ascending: false });

    if (agentId) {
      query = query.eq('agent_id', agentId);
    } else if (!isAdmin) {
      // If not admin and no specific agent filter, only show invoices for their agents
      if (userAgentIds.length === 0) {
        return NextResponse.json([]);
      }
      query = query.in('agent_id', userAgentIds);
    }

    if (paidFilter === 'true' || paidFilter === 'false') {
      query = query.eq('paid', paidFilter === 'true');
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch invoices';
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
    const { transactionId, agentId } = body;

    // Verify agent belongs to user
    const { data: agent, error: agentError } = await supabaseServer
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('tc_user_id', user.id)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: 'Agent not found or does not belong to you' },
        { status: 403 }
      );
    }

    // Get transaction details
    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (txError) throw txError;

    // Calculate fee: flat_fee + (purchase_price * commission_percent / 100)
    const flatFee = agent.flat_fee || 0;
    const percentageFee = (transaction.purchase_price * agent.commission_percent) / 100;
    const totalAmount = flatFee + percentageFee;

    // Generate invoice number (KEYSTN-YYYYMMDD-XXXXX)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    const { data: todayInvoices } = await supabaseServer
      .from('invoices')
      .select('id')
      .gte('invoice_date', today.toISOString().split('T')[0])
      .lt('invoice_date', new Date(today.getTime() + 86400000).toISOString().split('T')[0]);

    const invoiceNumber = `KEYSTN-${dateStr}-${String((todayInvoices?.length || 0) + 1).padStart(5, '0')}`;

    // Calculate due date (30 days from today)
    const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('invoices')
      .insert({
        agent_id: agentId,
        transaction_id: transactionId,
        amount_owed: totalAmount,
        invoice_number: invoiceNumber,
        invoice_date: today.toISOString(),
        due_date: dueDate.toISOString().split('T')[0],
        paid: false,
      })
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    return NextResponse.json(invoice);
  } catch (error) {
    console.error('Error creating invoice:', error);
    const message = error instanceof Error ? error.message : 'Failed to create invoice';
    return NextResponse.json(
      { error: message },
      { status: message.includes('Unauthorized') || message.includes('Missing') ? 401 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json();
    const { invoiceId, paid, paidAmount } = body;

    // Verify invoice belongs to user's agent
    const { data: invoice } = await supabaseServer
      .from('invoices')
      .select('agent_id')
      .eq('id', invoiceId)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Verify agent belongs to user
    const { data: agent } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('id', invoice.agent_id)
      .eq('tc_user_id', user.id)
      .single();

    if (!agent) {
      return NextResponse.json(
        { error: 'You do not have permission to update this invoice' },
        { status: 403 }
      );
    }

    const updateData: any = {
      paid,
      updated_at: new Date().toISOString(),
    };

    if (paid) {
      updateData.paid_at = new Date().toISOString();
      if (paidAmount) {
        updateData.paid_amount = paidAmount;
      }
    }

    const { data: updatedInvoice, error } = await supabaseServer
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .select(`
        *,
        agent:agents(id, name, brokerage, commission_percent, flat_fee),
        transaction:transactions(id, file_number, property_address, purchase_price)
      `)
      .single();

    if (error) throw error;

    return NextResponse.json(updatedInvoice);
  } catch (error) {
    console.error('Error updating invoice:', error);
    const message = error instanceof Error ? error.message : 'Failed to update invoice';
    return NextResponse.json(
      { error: message },
      { status: message.includes('Unauthorized') || message.includes('Missing') ? 401 : 500 }
    );
  }
}
