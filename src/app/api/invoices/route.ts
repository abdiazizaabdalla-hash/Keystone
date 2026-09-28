import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const agentId = request.nextUrl.searchParams.get('agentId');
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    const paidStatus = request.nextUrl.searchParams.get('paid');

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
      .select('*')
      .order('invoice_date', { ascending: false });

    if (agentId) {
      query = query.eq('agent_id', agentId);
    } else if (!isAdmin) {
      if (userAgentIds.length === 0) {
        return NextResponse.json([]);
      }
      query = query.in('agent_id', userAgentIds);
    }

    if (transactionId) {
      query = query.eq('transaction_id', transactionId);
    }

    if (paidStatus !== null) {
      const isPaid = paidStatus === 'true';
      query = query.eq('paid', isPaid);
    }

    const { data: invoiceRows, error } = await query;

    if (error) throw error;

    const invoiceList = invoiceRows || [];

    // Attach agent + transaction details manually — the invoices table has no
    // FK constraints to agents/transactions, so PostgREST's embedded-join
    // syntax (agent:agents(...)) can't resolve the relationship.
    const agentIds = [...new Set(invoiceList.map((i: any) => i.agent_id).filter(Boolean))];
    const transactionIds = [...new Set(invoiceList.map((i: any) => i.transaction_id).filter(Boolean))];

    const [agentsResult, transactionsResult] = await Promise.all([
      agentIds.length
        ? supabaseServer.from('agents').select('id, name, brokerage, email, commission_percent, flat_fee').in('id', agentIds)
        : Promise.resolve({ data: [] as any[] }),
      transactionIds.length
        ? supabaseServer.from('transactions').select('id, file_number, property_address, purchase_price').in('id', transactionIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const agentMap = new Map((agentsResult.data || []).map((a: any) => [a.id, a]));
    const transactionMap = new Map((transactionsResult.data || []).map((t: any) => [t.id, t]));

    const data = invoiceList.map((inv: any) => ({
      ...inv,
      agent: agentMap.get(inv.agent_id) || null,
      transaction: transactionMap.get(inv.transaction_id) || null,
    }));

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { agentId, transactionId, purchasePrice } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    // Commission % always comes from the agent's own settings (Agents
    // page), never from the client -- invoices are always created this
    // way, by the TC's own click, on every plan.
    const { data: agentRecord } = await supabaseServer
      .from('agents')
      .select('id, flat_fee, commission_percent, tc_user_id')
      .eq('id', agentId)
      .single();

    if (!isAdmin) {
      if (!agentRecord || agentRecord.tc_user_id !== user.id) {
        return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });
      }
    }

    // One invoice per transaction -- a direct user action, so a repeat
    // attempt gets a clear error instead of silently no-oping.
    const { data: existingInvoice } = await supabaseServer
      .from('invoices')
      .select('id')
      .eq('transaction_id', transactionId)
      .maybeSingle();

    if (existingInvoice) {
      return NextResponse.json(
        { error: 'This transaction already has an invoice.', code: 'invoice_exists' },
        { status: 409 }
      );
    }

    let dueDays = 30;
    if (agentRecord?.tc_user_id) {
      const { data: tcUser } = await supabaseServer.auth.admin.getUserById(agentRecord.tc_user_id);
      const configured = tcUser?.user?.user_metadata?.invoice_due_days;
      if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
        dueDays = configured;
      }
    }

    // Calculate total: flat fee + optional percentage-based fee (agent's
    // own commission_percent, not anything client-supplied -- see above).
    const percentageFeeAmount = (purchasePrice * (agentRecord?.commission_percent || 0)) / 100;
    const totalAmount = (agentRecord?.flat_fee || 0) + percentageFeeAmount;

    // Generate invoice number (RELAY-YYYYMMDD-XXXXX)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    // Get count of invoices created today to generate sequential number
    const { data: todayInvoices, error: countError } = await supabaseServer
      .from('invoices')
      .select('id')
      .gte('invoice_date', today.toISOString().split('T')[0])
      .lt('invoice_date', new Date(today.getTime() + 86400000).toISOString().split('T')[0]);

    if (countError) throw countError;

    const invoiceNumber = `RELAY-${dateStr}-${String((todayInvoices?.length || 0) + 1).padStart(5, '0')}`;

    // Calculate due date (TC's configured default, or 30 days if unset)
    const dueDate = new Date(today.getTime() + dueDays * 24 * 60 * 60 * 1000);

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

    return NextResponse.json(invoice, { status: 201 });
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
    console.error('Error creating invoice:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { invoiceId, paid, paidAmount, dueDate } = body;

    if (!isAdmin) {
      const { data: invoice } = await supabaseServer
        .from('invoices')
        .select('agent_id')
        .eq('id', invoiceId)
        .single();

      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', invoice.agent_id)
        .eq('tc_user_id', user.id)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to update this invoice' }, { status: 403 });
      }
    }

    const updateData: any = {};
    if (paid !== undefined) {
      updateData.paid = paid;
      if (paid) {
        updateData.paid_at = new Date().toISOString();
        updateData.paid_amount = paidAmount || null;
      } else {
        updateData.paid_at = null;
        updateData.paid_amount = null;
      }
    }

    if (dueDate !== undefined) {
      const parsed = new Date(dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'dueDate must be a valid date' }, { status: 400 });
      }
      updateData.due_date = parsed.toISOString().split('T')[0];
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updatedInvoice, error } = await supabaseServer
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .select()
      .single();

    if (error) throw error;

    const [{ data: agentRow }, { data: transactionRow }] = await Promise.all([
      updatedInvoice.agent_id
        ? supabaseServer.from('agents').select('id, name, brokerage, email, commission_percent, flat_fee').eq('id', updatedInvoice.agent_id).single()
        : Promise.resolve({ data: null }),
      updatedInvoice.transaction_id
        ? supabaseServer.from('transactions').select('id, file_number, property_address, purchase_price').eq('id', updatedInvoice.transaction_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const data = { ...updatedInvoice, agent: agentRow || null, transaction: transactionRow || null };

    return NextResponse.json(data);
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
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const { data: invoice, error: fetchError } = await supabaseServer
      .from('invoices')
      .select('id, agent_id')
      .eq('id', id)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', invoice.agent_id)
        .eq('tc_user_id', user.id)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to delete this invoice' }, { status: 403 });
      }
    }

    const { error: deleteError } = await supabaseServer
      .from('invoices')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
