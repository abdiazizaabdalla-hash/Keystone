import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, getAgentTransactionIds } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';

// Every transaction id the caller is allowed to see anything about --
// same three-way split (admin / agent / TC) used by GET /api/transactions,
// just returning ids instead of full rows since search needs to scope
// four different tables to the same set.
async function getVisibleTransactionIds(
  userId: string,
  isAdmin: boolean,
  isAgent: boolean
): Promise<string[]> {
  if (isAgent) {
    return getAgentTransactionIds(userId);
  }

  if (isAdmin) {
    const { data, error } = await supabaseServer.from('transactions').select('id');
    if (error) throw error;
    return (data || []).map((t) => t.id as string);
  }

  const visibleIds = await getVisibleTcUserIds(userId);
  const { data: userAgents, error: agentsError } = await supabaseServer
    .from('agents')
    .select('id')
    .in('tc_user_id', visibleIds);
  if (agentsError) throw agentsError;

  const agentIds = (userAgents || []).map((a) => a.id as string);
  if (agentIds.length === 0) return [];

  const { data: transactions, error: txError } = await supabaseServer
    .from('transactions')
    .select('id')
    .in('agent_id', agentIds);
  if (txError) throw txError;
  return (transactions || []).map((t) => t.id as string);
}

export type SearchResultType = 'transaction' | 'message' | 'document' | 'task';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  transactionId: string;
  propertyAddress: string | null;
  fileNumber: string | null;
  title: string;
  snippet: string | null;
  createdAt: string | null;
}

const RESULTS_PER_TYPE = 25;

// GET /api/search?q=...
//
// Plain authorized read across the tables that matter for "find this
// deal" -- transactions themselves, plus the communication/paperwork/
// checklist trail inside them. No rate limit: unlike the AI contract
// extraction route this costs nothing external, it's just a scoped
// Postgres query, same as every other list endpoint in the app.
//
// Requires the generated `search_vector` tsvector columns added by
// add-full-text-search.sql to exist in the database -- see that file.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const q = (request.nextUrl.searchParams.get('q') || '').trim();

    if (q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const callerIsAgent = isAgentUser(user);
    const transactionIds = await getVisibleTransactionIds(user.id, isAdmin, callerIsAgent);

    if (transactionIds.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const searchOpts = { type: 'websearch' as const, config: 'english' };

    const [transactionsRes, messagesRes, documentsRes, tasksRes] = await Promise.all([
      supabaseServer
        .from('transactions')
        .select('id, property_address, file_number, created_at')
        .in('id', transactionIds)
        .textSearch('search_vector', q, searchOpts)
        .limit(RESULTS_PER_TYPE),
      supabaseServer
        .from('messages')
        .select('id, transaction_id, body, sender_role, created_at')
        .in('transaction_id', transactionIds)
        .textSearch('search_vector', q, searchOpts)
        .order('created_at', { ascending: false })
        .limit(RESULTS_PER_TYPE),
      supabaseServer
        .from('documents')
        .select('id, transaction_id, file_name, document_type, category, created_at')
        .in('transaction_id', transactionIds)
        .textSearch('search_vector', q, searchOpts)
        .order('created_at', { ascending: false })
        .limit(RESULTS_PER_TYPE),
      supabaseServer
        .from('tasks')
        .select('id, transaction_id, name, waiting_on, created_at')
        .in('transaction_id', transactionIds)
        .textSearch('search_vector', q, searchOpts)
        .order('created_at', { ascending: false })
        .limit(RESULTS_PER_TYPE),
    ]);

    if (transactionsRes.error) throw transactionsRes.error;
    if (messagesRes.error) throw messagesRes.error;
    if (documentsRes.error) throw documentsRes.error;
    if (tasksRes.error) throw tasksRes.error;

    // Messages/documents/tasks results only carry transaction_id -- look
    // up each one's address/file number once so every result card can
    // show which deal it belongs to without a per-row round-trip.
    const relatedTxIds = new Set<string>();
    (messagesRes.data || []).forEach((m) => relatedTxIds.add(m.transaction_id as string));
    (documentsRes.data || []).forEach((d) => relatedTxIds.add(d.transaction_id as string));
    (tasksRes.data || []).forEach((t) => relatedTxIds.add(t.transaction_id as string));

    const txLookup = new Map<string, { propertyAddress: string | null; fileNumber: string | null }>();
    (transactionsRes.data || []).forEach((t) =>
      txLookup.set(t.id as string, {
        propertyAddress: t.property_address as string | null,
        fileNumber: t.file_number as string | null,
      })
    );
    const missingTxIds = [...relatedTxIds].filter((id) => !txLookup.has(id));
    if (missingTxIds.length > 0) {
      const { data: extraTx, error: extraTxError } = await supabaseServer
        .from('transactions')
        .select('id, property_address, file_number')
        .in('id', missingTxIds);
      if (extraTxError) throw extraTxError;
      (extraTx || []).forEach((t) =>
        txLookup.set(t.id as string, {
          propertyAddress: t.property_address as string | null,
          fileNumber: t.file_number as string | null,
        })
      );
    }

    const results: SearchResult[] = [];

    (transactionsRes.data || []).forEach((t) => {
      results.push({
        type: 'transaction',
        id: t.id as string,
        transactionId: t.id as string,
        propertyAddress: t.property_address as string | null,
        fileNumber: t.file_number as string | null,
        title: (t.property_address as string | null) || (t.file_number as string | null) || 'Transaction',
        snippet: null,
        createdAt: t.created_at as string | null,
      });
    });

    (messagesRes.data || []).forEach((m) => {
      const tx = txLookup.get(m.transaction_id as string);
      results.push({
        type: 'message',
        id: m.id as string,
        transactionId: m.transaction_id as string,
        propertyAddress: tx?.propertyAddress ?? null,
        fileNumber: tx?.fileNumber ?? null,
        title: m.sender_role === 'agent' ? 'Message from agent' : 'Message',
        snippet: (m.body as string | null)?.slice(0, 200) ?? null,
        createdAt: m.created_at as string | null,
      });
    });

    (documentsRes.data || []).forEach((d) => {
      const tx = txLookup.get(d.transaction_id as string);
      results.push({
        type: 'document',
        id: d.id as string,
        transactionId: d.transaction_id as string,
        propertyAddress: tx?.propertyAddress ?? null,
        fileNumber: tx?.fileNumber ?? null,
        title: (d.file_name as string | null) || 'Document',
        snippet: (d.document_type as string | null) || (d.category as string | null) || null,
        createdAt: d.created_at as string | null,
      });
    });

    (tasksRes.data || []).forEach((t) => {
      const tx = txLookup.get(t.transaction_id as string);
      results.push({
        type: 'task',
        id: t.id as string,
        transactionId: t.transaction_id as string,
        propertyAddress: tx?.propertyAddress ?? null,
        fileNumber: tx?.fileNumber ?? null,
        title: (t.name as string | null) || 'Task',
        snippet: (t.waiting_on as string | null) || null,
        createdAt: t.created_at as string | null,
      });
    });

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
