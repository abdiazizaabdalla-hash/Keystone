import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getVisibleTcUserIds } from '@/lib/team';

// GET: one row per transaction that has agent-portal messaging switched
// on (i.e. at least one accepted transaction_agents grant), across every
// transaction this TC (or their team) owns -- the "inbox" the new
// sidebar Messages tab opens into, see dashboard/messages/page.tsx. Each
// row carries just enough to render a preview (who, latest line, when)
// without the caller fetching every transaction's full thread.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);

    // Same split /api/transactions and /api/agents use: an admin sees
    // every tenant's agents/transactions, everyone else is scoped to
    // their own (or their team's) agent records.
    let agentsQuery = supabaseServer.from('agents').select('id, name, tc_user_id');
    if (!isAdmin) {
      const visibleIds = await getVisibleTcUserIds(user.id);
      agentsQuery = agentsQuery.in('tc_user_id', visibleIds);
    }
    const { data: userAgents, error: agentsError } = await agentsQuery;
    if (agentsError) throw agentsError;

    const agentNameById = new Map((userAgents || []).map((a) => [a.id as string, a.name as string]));
    const ownedAgentIds = (userAgents || []).map((a) => a.id as string);
    if (!isAdmin && ownedAgentIds.length === 0) {
      return NextResponse.json([]);
    }

    let txQuery = supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, agent_id')
      .order('created_at', { ascending: false });
    if (!isAdmin) {
      txQuery = txQuery.in('agent_id', ownedAgentIds);
    }
    const { data: transactions, error: txError } = await txQuery;
    if (txError) throw txError;
    if (!transactions || transactions.length === 0) {
      return NextResponse.json([]);
    }

    const txIds = transactions.map((t) => t.id as string);

    // Only transactions with at least one agent who's accepted portal
    // access actually have a conversation -- same gate the per-transaction
    // preview card uses (acceptedAgentUsers.length > 0).
    const { data: grants, error: grantsError } = await supabaseServer
      .from('transaction_agents')
      .select('transaction_id')
      .in('transaction_id', txIds);
    if (grantsError) throw grantsError;

    const messagingEnabledTxIds = new Set((grants || []).map((g) => g.transaction_id as string));
    const eligibleTransactions = transactions.filter((t) => messagingEnabledTxIds.has(t.id as string));
    if (eligibleTransactions.length === 0) {
      return NextResponse.json([]);
    }
    const eligibleTxIds = eligibleTransactions.map((t) => t.id as string);

    const { data: messages, error: messagesError } = await supabaseServer
      .from('messages')
      .select('transaction_id, sender_role, body, created_at, attachment_document_id')
      .in('transaction_id', eligibleTxIds)
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

    const result = eligibleTransactions.map((t) => {
      const last = lastMessageByTx.get(t.id as string) || null;
      return {
        transactionId: t.id,
        fileNumber: t.file_number,
        propertyAddress: t.property_address,
        agentName: agentNameById.get(t.agent_id as string) || 'Agent',
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
    // messages yet (last === null) sort to the bottom, newest-created first.
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
    console.error('Error building messages overview:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
