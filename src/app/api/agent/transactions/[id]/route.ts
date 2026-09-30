import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, assertAgentOnTransaction } from '@/lib/agentPortal';

// GET: one transaction's read-only view for an agent -- status and
// checklist, plus who the TC is so the portal can label the message
// thread. No purchase price breakdown, no invoice/commission fields --
// those stay TC-only (see the design notes in lib/agentPortal.ts).
// Documents are fetched separately from the existing /api/documents
// route (now agent-aware, see that file).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) {
      return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    }

    const { id: transactionId } = await params;
    await assertAgentOnTransaction(transactionId, user.id);

    const { data: transaction, error } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, status, agent_id')
      .eq('id', transactionId)
      .single();
    if (error || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const { data: tasks, error: tasksError } = await supabaseServer
      .from('tasks')
      .select('id, name, completed, sort_order')
      .eq('transaction_id', transactionId)
      .order('sort_order', { ascending: true });
    if (tasksError) throw tasksError;

    let tcLabel = 'Transaction coordinator';
    const { data: agentRecord } = await supabaseServer
      .from('agents')
      .select('tc_user_id')
      .eq('id', transaction.agent_id)
      .maybeSingle();
    if (agentRecord?.tc_user_id) {
      const { data } = await supabaseServer.auth.admin.getUserById(agentRecord.tc_user_id);
      tcLabel = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || tcLabel;
    }

    return NextResponse.json({
      id: transaction.id,
      fileNumber: transaction.file_number,
      propertyAddress: transaction.property_address,
      status: transaction.status,
      tcLabel,
      tasks: tasks || [],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agent transaction:', error);
    return NextResponse.json({ error: 'Failed to fetch transaction' }, { status: 500 });
  }
}
