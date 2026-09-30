import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, getAgentTransactionIds } from '@/lib/agentPortal';

// GET: every transaction this agent has been added to, across every TC
// that's invited them -- the "one login, union of what I've been added
// to" list (see src/app/agent/page.tsx). Deliberately minimal fields:
// no purchase price breakdown beyond what's needed to identify the deal,
// and nothing about invoices/commission -- see assertions in the design
// notes in lib/agentPortal.ts.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) {
      return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    }

    const transactionIds = await getAgentTransactionIds(user.id);
    if (transactionIds.length === 0) {
      return NextResponse.json([]);
    }

    const { data: transactions, error } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, status, agent_id')
      .in('id', transactionIds)
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const agentRecordIds = [...new Set((transactions || []).map((t) => t.agent_id).filter(Boolean))];
    const { data: agentRecords } = agentRecordIds.length
      ? await supabaseServer.from('agents').select('id, tc_user_id').in('id', agentRecordIds)
      : { data: [] as { id: string; tc_user_id: string }[] };

    const tcUserIds = [...new Set((agentRecords || []).map((a) => a.tc_user_id).filter(Boolean))];
    const tcLabels = new Map<string, string>();
    await Promise.all(
      tcUserIds.map(async (tcId) => {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator';
        tcLabels.set(tcId, label);
      })
    );
    const agentToTc = new Map((agentRecords || []).map((a) => [a.id, a.tc_user_id]));

    const result = (transactions || []).map((t) => ({
      id: t.id,
      fileNumber: t.file_number,
      propertyAddress: t.property_address,
      status: t.status,
      tcLabel: tcLabels.get(agentToTc.get(t.agent_id) || '') || 'Transaction coordinator',
    }));

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agent transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
