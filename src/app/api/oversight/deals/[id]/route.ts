import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { agentLabels, assertBrokerageOwner, canOverseeDeal, dealHealth } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';

// One deal of an agent in this brokerage, read-only: the deal, its checklist, key dates and the names of its documents.
// Changes are made through the normal deal and checklist routes, which accept the brokerage owner for these deals.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    if (!(await canOverseeDeal(user.id, id))) throw new AuthError('Not found', 404);

    const { data: deal, error } = await supabaseServer
      .from('transactions')
      .select('id, tc_user_id, property_address, file_number, status, purchase_price, acceptance_date, closing_date, updated_at, created_at')
      .eq('id', id)
      .single();
    if (error) throw error;
    const { data: tasks } = await supabaseServer.from('tasks').select('id, name, completed, due_date, waiting_on, sort_order').eq('transaction_id', id).order('sort_order', { ascending: true });
    const { data: keyDates } = await supabaseServer.from('transaction_key_dates').select('id, kind, label, due_date, completed').eq('transaction_id', id).order('due_date', { ascending: true });
    const { data: documents } = await supabaseServer.from('documents').select('id, file_name, created_at').eq('transaction_id', id).order('created_at', { ascending: false }).limit(100);
    const labels = await agentLabels([deal.tc_user_id as string]);
    return NextResponse.json({
      deal,
      agent: labels.get(deal.tc_user_id as string) ?? null,
      tasks: tasks ?? [],
      keyDates: keyDates ?? [],
      documents: documents ?? [],
      health: dealHealth(deal as { status: string | null; acceptance_date: string | null; closing_date: string | null }, tasks ?? [], todayIso()),
      canEdit: true,
    });
  } catch (error) {
    return oversightError(error, 'load that deal');
  }
}
