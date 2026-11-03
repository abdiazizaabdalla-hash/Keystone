import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const body = await request.json();
    const { status } = body;

    // Update transaction status
    const { data: transaction, error: updateError } = await supabaseServer
      .from('transactions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', transactionId)
      .select()
      .single();

    if (updateError) throw updateError;

    // If status is "Closed", auto-generate invoice
    if (status === 'Closed') {
      // Get agent info for fee calculation
      const { data: agent, error: agentError } = await supabaseServer
        .from('agents')
        .select('*')
        .eq('id', transaction.agent_id)
        .single();

      if (agentError) throw agentError;

      // Check if invoice already exists
      const { data: existingInvoice } = await supabaseServer
        .from('invoices')
        .select('id')
        .eq('transaction_id', transactionId)
        .single();

      // Only create if invoice doesn't exist
      if (!existingInvoice) {
        // Calculate fee: flat_fee + (purchase_price * commission_percent / 100)
        const flatFee = agent.flat_fee || 0;
        const percentageFee = (transaction.purchase_price * agent.commission_percent) / 100;
        const totalAmount = flatFee + percentageFee;

        // Generate invoice number (RELAY-YYYYMMDD-XXXXX)
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

        const { data: todayInvoices } = await supabaseServer
          .from('invoices')
          .select('id')
          .gte('invoice_date', today.toISOString().split('T')[0])
          .lt('invoice_date', new Date(today.getTime() + 86400000).toISOString().split('T')[0]);

        const invoiceNumber = `RELAY-${dateStr}-${String((todayInvoices?.length || 0) + 1).padStart(5, '0')}`;

        // Calculate due date (30 days from today)
        const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Create invoice
        const { error: invoiceError } = await supabaseServer
          .from('invoices')
          .insert({
            agent_id: transaction.agent_id,
            transaction_id: transactionId,
            amount_owed: totalAmount,
            invoice_number: invoiceNumber,
            invoice_date: today.toISOString(),
            due_date: dueDate.toISOString().split('T')[0],
            paid: false,
          });

        if (invoiceError) console.warn('Warning: Invoice creation failed but transaction updated', invoiceError);
      }
    }

    return NextResponse.json(transaction);
  } catch (error) {
    console.error('Error updating transaction:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}
