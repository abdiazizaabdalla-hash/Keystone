import { supabaseServer } from '@/lib/supabase';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';

// Platform-admin view of how each coordinator uses Relay: when they last did something, and how much of each feature they have used.
// Counts and dates only. No message text, document contents, client names or prices leave this file.

const CLOSED = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1];

export interface UserActivity {
  userId: string;
  lastActiveAt: string | null;
  lastActiveWhat: string | null;
  deals: number;
  openDeals: number;
  closedDeals: number;
  listings: number;
  agentProfiles: number;
  contacts: number;
  stepsDone: number;
  stepsTotal: number;
  documents: number;
  documentBytes: number;
  lastDocumentAt: string | null;
  messagesSent: number;
  clientMessages: number;
  emailsReceived: number;
  invoices: number;
  invoicesSent: number;
  invoicesPaid: number;
  signingRequests: number;
  signingSigned: number;
  shareLinks: number;
  commissionStatements: number;
  aiReads: number;
}

/** Reads a whole table (PostgREST caps a request at 1000 rows). */
async function all<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    let q = supabaseServer.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) {
      // A table or column from an update that has not been run yet: report nothing for it rather than failing the page.
      if (error.code === '42P01' || error.code === '42703') return out;
      throw error;
    }
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const blank = (userId: string): UserActivity => ({
  userId, lastActiveAt: null, lastActiveWhat: null, deals: 0, openDeals: 0, closedDeals: 0, listings: 0, agentProfiles: 0, contacts: 0, stepsDone: 0, stepsTotal: 0,
  documents: 0, documentBytes: 0, lastDocumentAt: null, messagesSent: 0, clientMessages: 0, emailsReceived: 0, invoices: 0, invoicesSent: 0, invoicesPaid: 0,
  signingRequests: 0, signingSigned: 0, shareLinks: 0, commissionStatements: 0, aiReads: 0,
});

export async function loadActivity(authLastSignIn: Map<string, string | null>): Promise<Map<string, UserActivity>> {
  const result = new Map<string, UserActivity>();
  const get = (id: string) => {
    let a = result.get(id);
    if (!a) { a = blank(id); result.set(id, a); }
    return a;
  };
  const touch = (id: string | null | undefined, when: string | null | undefined, what: string) => {
    if (!id || !when) return;
    const a = get(id);
    if (!a.lastActiveAt || when > a.lastActiveAt) { a.lastActiveAt = when; a.lastActiveWhat = what; }
  };

  for (const [id, at] of authLastSignIn) touch(id, at, 'Signed in');

  const [txs, agents, listings, contacts, audit, ai] = await Promise.all([
    all<{ id: string; tc_user_id: string; status: string; created_at: string; updated_at: string | null }>('transactions', 'id, tc_user_id, status, created_at, updated_at'),
    all<{ id: string; tc_user_id: string; created_at: string }>('agents', 'id, tc_user_id, created_at'),
    all<{ tc_user_id: string; created_at: string; updated_at: string | null }>('listings', 'tc_user_id, created_at, updated_at'),
    all<{ tc_user_id: string; created_at: string; updated_at: string | null }>('contacts', 'tc_user_id, created_at, updated_at'),
    all<{ actor_id: string | null; action: string; created_at: string }>('audit_log', 'actor_id, action, created_at', (q) => q.not('actor_id', 'is', null)),
    all<{ user_id: string; created_at: string }>('ai_usage', 'user_id, created_at'),
  ]);

  const tcOfTx = new Map<string, string>();
  for (const t of txs) {
    tcOfTx.set(t.id, t.tc_user_id);
    const a = get(t.tc_user_id);
    a.deals += 1;
    if (t.status === CLOSED) a.closedDeals += 1; else a.openDeals += 1;
    touch(t.tc_user_id, t.created_at, 'Created a deal');
    touch(t.tc_user_id, t.updated_at, 'Updated a deal');
  }
  const tcOfAgent = new Map<string, string>();
  for (const g of agents) { tcOfAgent.set(g.id, g.tc_user_id); get(g.tc_user_id).agentProfiles += 1; touch(g.tc_user_id, g.created_at, 'Added an agent'); }
  for (const l of listings) { get(l.tc_user_id).listings += 1; touch(l.tc_user_id, l.created_at, 'Created a listing'); touch(l.tc_user_id, l.updated_at, 'Updated a listing'); }
  for (const c of contacts) { get(c.tc_user_id).contacts += 1; touch(c.tc_user_id, c.created_at, 'Added a contact'); touch(c.tc_user_id, c.updated_at, 'Edited a contact'); }
  for (const e of audit) touch(e.actor_id, e.created_at, e.action);
  for (const r of ai) { get(r.user_id).aiReads += 1; touch(r.user_id, r.created_at, 'Used AI'); }

  const forTx = <T extends { transaction_id: string }>(rows: T[], fn: (tc: string, row: T) => void) => { for (const r of rows) { const tc = tcOfTx.get(r.transaction_id); if (tc) fn(tc, r); } };

  const [tasks, docs, msgs, clientMsgs, emails, invoices, signing, links, directs, teamMsgs, statements] = await Promise.all([
    all<{ transaction_id: string; completed: boolean; completed_at?: string | null }>('tasks', 'transaction_id, completed, completed_at'),
    all<{ transaction_id: string; file_size: number | null; created_at: string; uploaded_by: string | null }>('documents', 'transaction_id, file_size, created_at, uploaded_by'),
    all<{ transaction_id: string; sender_id: string | null; created_at: string }>('messages', 'transaction_id, sender_id, created_at'),
    all<{ transaction_id: string; sender_type: string | null; created_at: string }>('client_messages', 'transaction_id, sender_type, created_at'),
    all<{ transaction_id: string; received_at: string | null; created_at: string }>('transaction_emails', 'transaction_id, received_at, created_at'),
    all<{ agent_id: string; paid: boolean | null; sent_at: string | null; created_at: string }>('invoices', 'agent_id, paid, sent_at, created_at'),
    all<{ transaction_id: string | null; status: string; requested_by: string | null; created_at: string }>('signing_requests', 'transaction_id, status, requested_by, created_at'),
    all<{ transaction_id: string; created_at: string }>('external_access_links', 'transaction_id, created_at'),
    all<{ tc_user_id: string; sender_id: string | null; created_at: string }>('direct_messages', 'tc_user_id, sender_id, created_at'),
    all<{ sender_id: string | null; created_at: string }>('team_messages', 'sender_id, created_at'),
    all<{ owner_user_id: string; created_at?: string; updated_at: string | null }>('deal_commissions', 'owner_user_id, updated_at'),
  ]);

  forTx(tasks, (tc, t) => { const a = get(tc); a.stepsTotal += 1; if (t.completed) { a.stepsDone += 1; touch(tc, t.completed_at, 'Completed a step'); } });
  forTx(docs, (tc, d) => {
    const a = get(tc); a.documents += 1; a.documentBytes += d.file_size || 0;
    if (!a.lastDocumentAt || d.created_at > a.lastDocumentAt) a.lastDocumentAt = d.created_at;
    if (d.uploaded_by === tc) touch(tc, d.created_at, 'Uploaded a document');
  });
  forTx(msgs, (tc, m) => { if (m.sender_id === tc) { get(tc).messagesSent += 1; touch(tc, m.created_at, 'Sent a message'); } });
  forTx(clientMsgs, (tc, m) => { get(tc).clientMessages += 1; if (m.sender_type !== 'client') touch(tc, m.created_at, 'Messaged a client'); });
  forTx(emails, (tc) => { get(tc).emailsReceived += 1; });
  for (const i of invoices) {
    const tc = tcOfAgent.get(i.agent_id); if (!tc) continue;
    const a = get(tc); a.invoices += 1; if (i.sent_at) a.invoicesSent += 1; if (i.paid) a.invoicesPaid += 1;
    touch(tc, i.created_at, 'Created an invoice'); touch(tc, i.sent_at, 'Sent an invoice');
  }
  for (const s of signing) {
    const tc = s.requested_by || (s.transaction_id ? tcOfTx.get(s.transaction_id) : undefined); if (!tc) continue;
    const a = get(tc); a.signingRequests += 1; if (s.status === 'signed' || s.status === 'completed') a.signingSigned += 1;
    touch(tc, s.created_at, 'Sent a signing request');
  }
  forTx(links, (tc, l) => { get(tc).shareLinks += 1; touch(tc, l.created_at, 'Created a share link'); });
  for (const d of directs) if (d.sender_id === d.tc_user_id) { get(d.tc_user_id).messagesSent += 1; touch(d.tc_user_id, d.created_at, 'Sent a message'); }
  for (const m of teamMsgs) if (m.sender_id) { get(m.sender_id).messagesSent += 1; touch(m.sender_id, m.created_at, 'Sent a team message'); }
  for (const c of statements) { get(c.owner_user_id).commissionStatements += 1; touch(c.owner_user_id, c.updated_at, 'Worked on a commission'); }
  return result;
}

/** One account in detail: recent actions, deals (no client names or prices), documents (file names only). */
export async function loadActivityDetail(userId: string) {
  const [audit, deals, agents] = await Promise.all([
    supabaseServer.from('audit_log').select('action, created_at').eq('actor_id', userId).order('created_at', { ascending: false }).limit(25),
    supabaseServer.from('transactions').select('id, file_number, property_address, status, acceptance_date, closing_date, created_at, updated_at').eq('tc_user_id', userId).order('created_at', { ascending: false }).limit(100),
    supabaseServer.from('agents').select('name, brokerage, created_at').eq('tc_user_id', userId).order('created_at', { ascending: false }).limit(100),
  ]);
  const ids = (deals.data || []).map((d) => d.id as string);
  const docs = ids.length ? await supabaseServer.from('documents').select('transaction_id, file_name, category, file_size, created_at').in('transaction_id', ids).order('created_at', { ascending: false }).limit(200) : { data: [] };
  const tasks = ids.length ? await supabaseServer.from('tasks').select('transaction_id, completed').in('transaction_id', ids).limit(5000) : { data: [] };
  const progress = new Map<string, { done: number; total: number }>();
  for (const t of tasks.data || []) { const p = progress.get(t.transaction_id as string) || { done: 0, total: 0 }; p.total += 1; if (t.completed) p.done += 1; progress.set(t.transaction_id as string, p); }
  return {
    recentActions: audit.data || [],
    deals: (deals.data || []).map((d) => ({ ...d, steps: progress.get(d.id as string) || { done: 0, total: 0 } })),
    documents: docs.data || [],
    agents: agents.data || [],
  };
}
