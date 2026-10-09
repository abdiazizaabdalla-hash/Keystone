import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getUserPlan } from '@/lib/privileged';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';

type Row = Record<string, unknown>;

// Reads every row of a query in 1000-row pages (Supabase's per-request cap),
// so a large account isn't silently truncated.
async function fetchAll(
  table: string,
  column: string,
  ids: string[]
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const rows: Row[] = [];
  // `.in()` goes in the URL, so keep each batch of ids modest.
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseServer
        .from(table)
        .select('*')
        .in(column, batch)
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data as Row[]) || []));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
}

// Secrets and access tokens aren't "your data" -- drop them from the file.
function clean(rows: Row[]): Row[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !/token|secret/i.test(key)))
  );
}

// GET /api/account/export -- a JSON copy of the caller's own account and the
// business data they own (agents, transactions, checklist tasks, document
// records, contacts, invoices, messages, signature requests, templates).
// Uploaded files themselves are listed (name, size, type) but not embedded;
// they can be downloaded one by one from each transaction.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    if (!(await checkRateLimit(`account-export:${user.id}`, 5, 60 * 60))) {
      return NextResponse.json({ error: 'Too many export requests. Try again later.' }, { status: 429 });
    }

    const agents = await fetchAll('agents', 'tc_user_id', [user.id]);
    const transactions = await fetchAll('transactions', 'tc_user_id', [user.id]);
    const txIds = transactions.map((t) => String(t.id));
    const agentIds = agents.map((a) => String(a.id));

    const [templates, tasks, documents, contacts, invoices, messages, signingRequests] = await Promise.all([
      fetchAll('checklist_templates', 'tc_user_id', [user.id]),
      fetchAll('tasks', 'transaction_id', txIds),
      fetchAll('documents', 'transaction_id', txIds),
      fetchAll('transaction_contacts', 'transaction_id', txIds),
      fetchAll('invoices', 'transaction_id', txIds),
      fetchAll('messages', 'transaction_id', txIds),
      fetchAll('signing_requests', 'transaction_id', txIds),
    ]);

    // Team chat messages this person sent. Best-effort: a missing table (the
    // messaging SQL not run yet) must never break the rest of the export.
    let teamMessages: Row[] = [];
    try {
      teamMessages = await fetchAll('team_messages', 'sender_id', [user.id]);
    } catch {
      teamMessages = [];
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        fullName: (user.user_metadata as { full_name?: string } | null)?.full_name ?? null,
        plan: getUserPlan(user),
        createdAt: user.created_at,
        termsAcceptedAt: (user.app_metadata as { terms_accepted_at?: string } | null)?.terms_accepted_at ?? null,
      },
      agents: clean(agents),
      transactions: clean(transactions),
      tasks: clean(tasks),
      documents: clean(documents), // file records only; download the files from each transaction
      contacts: clean(contacts),
      invoices: clean(invoices),
      messages: clean(messages),
      signingRequests: clean(signingRequests),
      teamMessagesSent: clean(teamMessages),
      checklistTemplates: clean(templates),
      note:
        agentIds.length === 0 && txIds.length === 0
          ? 'No transactions or agents are stored for this account.'
          : undefined,
    };

    await logAudit(request, user, 'account.export', {
      entityType: 'user',
      entityId: user.id,
      metadata: { transactions: txIds.length, documents: documents.length },
    });

    const dateStr = new Date().toISOString().split('T')[0];
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="relay-data-export-${dateStr}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error exporting account data:', error);
    return NextResponse.json({ error: 'Failed to export your data' }, { status: 500 });
  }
}
