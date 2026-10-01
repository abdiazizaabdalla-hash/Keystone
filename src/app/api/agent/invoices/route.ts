import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, assertAgentOnTransaction } from '@/lib/agentPortal';

// GET: the invoice(s) for one transaction, from the invited agent's own
// side -- deliberately narrow fields (no commission_percent/flat_fee,
// nothing about other agents or transactions) since this is reachable by
// the agent, not just the TC. Mirrors enough of GET /api/invoices's shape
// for the agent transaction page to show the same Paid/Unpaid status and
// pay link the TC's own invoice page does, just scoped to one
// transaction instead of across every agent a TC has.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) {
      return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    }

    const transactionId = request.nextUrl.searchParams.get('transactionId');
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    await assertAgentOnTransaction(transactionId, user.id);

    const { data: invoices, error } = await supabaseServer
      .from('invoices')
      .select('id, invoice_number, amount_owed, due_date, invoice_date, paid, paid_at, paid_amount, refunded, refunded_at')
      .eq('transaction_id', transactionId)
      .order('invoice_date', { ascending: false });
    if (error) throw error;

    return NextResponse.json(invoices || []);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agent invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}
