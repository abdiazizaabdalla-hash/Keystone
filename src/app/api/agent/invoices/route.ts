import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, assertAgentOnTransaction, getAgentTransactionIds } from '@/lib/agentPortal';
import { isStripePayAvailable } from '@/lib/stripeConnect';

const INVOICE_FIELDS =
  'id, invoice_number, amount_owed, due_date, invoice_date, paid, paid_at, paid_amount, refunded, refunded_at, transaction_id';

// GET: the invoice(s) for this agent -- deliberately narrow fields (no
// commission_percent/flat_fee, nothing about other agents or
// transactions) since this is reachable by the agent, not just the TC.
//
// With ?transactionId=..., scoped to one deal -- the original shape this
// route had, still used by the agent's per-transaction page.
//
// Without it, every invoice across every transaction this agent has been
// added to, across every TC that's invited them -- the same "one login,
// union of what I've been added to" idea as GET /api/agent/transactions,
// just for invoices instead of deals. Each row carries enough of its
// transaction (file number/address, which TC) for a standalone list to
// be readable without a second round-trip per invoice.
//
// Every invoice also carries `payOnline`: whether its TC has an approved
// Stripe Connect account right now. The agent-facing pages use this to
// decide whether to offer "Pay Now" at all -- an agent clicking Pay and
// hitting "the TC hasn't finished Stripe onboarding" is a dead end only
// the TC can act on, so it's better not to offer the button in the first
// place. When it's false, those pages fall back to "invoice sent --
// download the PDF" instead.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) {
      return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    }

    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (transactionId) {
      await assertAgentOnTransaction(transactionId, user.id);

      const { data: invoices, error } = await supabaseServer
        .from('invoices')
        .select(INVOICE_FIELDS)
        .eq('transaction_id', transactionId)
        .order('invoice_date', { ascending: false });
      if (error) throw error;

      let payOnline = false;
      if (invoices && invoices.length > 0) {
        const { data: transaction } = await supabaseServer
          .from('transactions')
          .select('agent_id')
          .eq('id', transactionId)
          .maybeSingle();
        if (transaction?.agent_id) {
          const { data: agentRecord } = await supabaseServer
            .from('agents')
            .select('tc_user_id')
            .eq('id', transaction.agent_id)
            .maybeSingle();
          if (agentRecord?.tc_user_id) {
            payOnline = await isStripePayAvailable(agentRecord.tc_user_id);
          }
        }
      }

      return NextResponse.json((invoices || []).map((inv) => ({ ...inv, payOnline })));
    }

    const transactionIds = await getAgentTransactionIds(user.id);
    if (transactionIds.length === 0) {
      return NextResponse.json([]);
    }

    const { data: invoices, error } = await supabaseServer
      .from('invoices')
      .select(INVOICE_FIELDS)
      .in('transaction_id', transactionIds)
      .order('invoice_date', { ascending: false });
    if (error) throw error;
    if (!invoices || invoices.length === 0) {
      return NextResponse.json([]);
    }

    const invoiceTxIds = [...new Set(invoices.map((i) => i.transaction_id as string))];
    const { data: transactions } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, agent_id')
      .in('id', invoiceTxIds);

    const agentRecordIds = [...new Set((transactions || []).map((t) => t.agent_id).filter(Boolean))];
    const { data: agentRecords } = agentRecordIds.length
      ? await supabaseServer.from('agents').select('id, tc_user_id').in('id', agentRecordIds)
      : { data: [] as { id: string; tc_user_id: string }[] };
    const agentToTc = new Map((agentRecords || []).map((a) => [a.id, a.tc_user_id]));

    const tcUserIds = [...new Set((agentRecords || []).map((a) => a.tc_user_id).filter(Boolean))];
    const tcLabels = new Map<string, string>();
    const tcPayOnline = new Map<string, boolean>();
    await Promise.all(
      tcUserIds.map(async (tcId) => {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator';
        tcLabels.set(tcId, label);
        tcPayOnline.set(tcId, await isStripePayAvailable(tcId));
      })
    );

    const txById = new Map((transactions || []).map((t) => [t.id as string, t]));

    const result = invoices.map((inv) => {
      const tx = txById.get(inv.transaction_id as string);
      const tcUserId = tx ? agentToTc.get(tx.agent_id) || '' : '';
      return {
        ...inv,
        payOnline: tcPayOnline.get(tcUserId) || false,
        transaction: tx
          ? {
              id: tx.id,
              fileNumber: tx.file_number,
              propertyAddress: tx.property_address,
              tcLabel: tcLabels.get(tcUserId) || 'Transaction coordinator',
            }
          : null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agent invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}
