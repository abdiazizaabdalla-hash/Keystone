import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, getAgentTransactionIds } from '@/lib/agentPortal';

// GET: one row per transaction this agent has been added to, with a
// preview of its latest message -- the agent-side mirror of
// /api/messages/overview, feeding the new Messages tab in the agent
// portal (agent/messages/page.tsx). Every transaction getAgentTransactionIds
// returns already has portal access switched on by definition, so unlike
// the TC version there's no separate "is messaging enabled" filter here.
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

    const { data: transactions, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, agent_id')
      .in('id', transactionIds);
    if (txError) throw txError;
    if (!transactions || transactions.length === 0) {
      return NextResponse.json([]);
    }

    const agentRecordIds = [...new Set(transactions.map((t) => t.agent_id).filter(Boolean))];
    const { data: agentRecords } = agentRecordIds.length
      ? await supabaseServer.from('agents').select('id, tc_user_id').in('id', agentRecordIds)
      : { data: [] as { id: string; tc_user_id: string }[] };
    const agentToTc = new Map((agentRecords || []).map((a) => [a.id as string, a.tc_user_id as string]));

    const tcUserIds = [...new Set((agentRecords || []).map((a) => a.tc_user_id).filter(Boolean))];
    const tcLabels = new Map<string, string>();
    await Promise.all(
      tcUserIds.map(async (tcId) => {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator';
        tcLabels.set(tcId, label);
      })
    );

    const { data: messages, error: messagesError } = await supabaseServer
      .from('messages')
      .select('transaction_id, sender_role, body, created_at, attachment_document_id')
      .in('transaction_id', transactionIds)
      .order('created_at', { ascending: false });
    if (messagesError) throw messagesError;

    // Most-recent message per transaction -- messages came back newest
    // first, so the first hit per transaction_id wins.
    const lastMessageByTx = new Map<
      string,
      { sender_role: 'tc' | 'agent'; body: string; created_at: string; attachment_document_id: string | null }
    >();
    (messages || []).forEach((m) => {
      const txId = m.transaction_id as string;
      if (!lastMessageByTx.has(txId)) {
        lastMessageByTx.set(txId, {
          sender_role: m.sender_role,
          body: m.body,
          created_at: m.created_at,
          attachment_document_id: m.attachment_document_id,
        });
      }
    });

    const attachmentIds = [...new Set([...lastMessageByTx.values()].map((m) => m.attachment_document_id).filter(Boolean))];
    const fileNameById = new Map<string, string>();
    if (attachmentIds.length > 0) {
      const { data: docs } = await supabaseServer
        .from('documents')
        .select('id, file_name')
        .in('id', attachmentIds as string[]);
      (docs || []).forEach((d) => fileNameById.set(d.id as string, d.file_name as string));
    }

    const result = transactions.map((t) => {
      const last = lastMessageByTx.get(t.id as string) || null;
      const tcUserId = agentToTc.get(t.agent_id as string) || '';
      return {
        transactionId: t.id,
        fileNumber: t.file_number,
        propertyAddress: t.property_address,
        tcLabel: tcLabels.get(tcUserId) || 'Transaction coordinator',
        lastMessage: last
          ? {
              senderRole: last.sender_role,
              body: last.body,
              createdAt: last.created_at,
              attachmentFileName: last.attachment_document_id ? fileNameById.get(last.attachment_document_id) || null : null,
            }
          : null,
      };
    });

    // Most recently active conversations first; transactions with no
    // messages yet (last === null) sort to the bottom.
    result.sort((a, b) => {
      const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : -1;
      const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : -1;
      return bTime - aTime;
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error building agent messages overview:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
