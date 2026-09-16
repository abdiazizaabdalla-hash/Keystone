import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get('agentId');
    const paidStatus = request.nextUrl.searchParams.get('paid');

    let query = supabaseServer
      .from('invoices')
      .select(`
        *,
        agent:agents(name, brokerage, commission_percent),
        transaction:transactions(file_number, property_address, purchase_price)
      `)
      .order('invoice_date', { ascending: false });

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    if (paidStatus !== null) {
      const isPaid = paidStatus === 'true';
      query = query.eq('paid', isPaid);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, transactionId, purchasePrice, commissionPercent } = body;

    // Calculate commission amount
    const commissionAmount = (purchasePrice * commissionPercent) / 100;

    // Generate invoice number (KEYSTN-YYYYMMDD-XXXXX)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
    
    // Get count of invoices created today to generate sequential number
    const { data: todayInvoices, error: countError } = await supabaseServer
      .from('invoices')
      .select('id')
      .gte('invoice_date', today.toISOString().split('T')[0])
      .lt('invoice_date', new Date(today.getTime() + 86400000).toISOString().split('T')[0]);

    if (countError) throw countError;

    const invoiceNumber = `KEYSTN-${dateStr}-${String((todayInvoices?.length || 0) + 1).padStart(5, '0')}`;

    // Calculate due date (30 days from today)
    const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('invoices')
      .insert({
        agent_id: agentId,
        transaction_id: transactionId,
        amount_owed: commissionAmount,
        invoice_number: invoiceNumber,
        invoice_date: today.toISOString(),
        due_date: dueDate.toISOString().split('T')[0],
        paid: false,
      })
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId, paid, paidAmount } = body;

    const updateData: any = { paid };
    if (paid) {
      updateData.paid_at = new Date().toISOString();
      updateData.paid_amount = paidAmount || null;
    } else {
      updateData.paid_at = null;
      updateData.paid_amount = null;
    }

    const { data, error } = await supabaseServer
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}
