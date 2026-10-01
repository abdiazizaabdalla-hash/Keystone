import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';

// GET: this agent's own pending invites, across every TC that's invited
// this email -- scoped to the caller's own verified email (from their
// token), the same trust boundary POST /api/agent-invites/accept already
// uses. Surfaced on /agent (see src/app/agent/page.tsx) so a plain
// sign-in -- not a transaction-specific link -- still shows what's
// waiting for them, with an explicit Accept action instead of
// /agent/accept auto-granting access the moment a link is clicked.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user) || !user.email) {
      return NextResponse.json([]);
    }

    const { data: invites, error: invitesError } = await supabaseServer
      .from('agent_invites')
      .select('id, transaction_id, created_at')
      .eq('email', user.email.toLowerCase())
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (invitesError) throw invitesError;
    if (!invites || invites.length === 0) {
      return NextResponse.json([]);
    }

    const transactionIds = [...new Set(invites.map((i) => i.transaction_id as string))];
    const { data: transactions, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, agent_id')
      .in('id', transactionIds);
    if (txError) throw txError;

    const txById = new Map((transactions || []).map((t) => [t.id as string, t]));

    const agentRecordIds = [...new Set((transactions || []).map((t) => t.agent_id).filter(Boolean))];
    const { data: agentRecords } = agentRecordIds.length
      ? await supabaseServer.from('agents').select('id, tc_user_id').in('id', agentRecordIds)
      : { data: [] as { id: string; tc_user_id: string }[] };
    const agentToTc = new Map((agentRecords || []).map((a) => [a.id, a.tc_user_id]));

    const tcUserIds = [...new Set((agentRecords || []).map((a) => a.tc_user_id).filter(Boolean))];
    const tcLabels = new Map<string, string>();
    await Promise.all(
      tcUserIds.map(async (tcId) => {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator';
        tcLabels.set(tcId, label);
      })
    );

    const result = invites
      .map((invite) => {
        const tx = txById.get(invite.transaction_id as string);
        if (!tx) return null;
        const tcUserId = agentToTc.get(tx.agent_id) || '';
        return {
          inviteId: invite.id,
          transactionId: tx.id,
          fileNumber: tx.file_number,
          propertyAddress: tx.property_address,
          tcLabel: tcLabels.get(tcUserId) || 'Transaction coordinator',
          createdAt: invite.created_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching pending agent invites:', error);
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 });
  }
}
