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

type Row = Record<string, unknown>;
/** A query that may hit a table or column from an update not run yet: that section is just empty. */
async function safe(run: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<Row[]> {
  try {
    const { data, error } = await run();
    if (error) return [];
    return (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  } catch { return []; }
}
const pick = (row: Row | undefined, keys: string[]) => Object.fromEntries(keys.filter((k) => row && row[k] !== undefined && row[k] !== null).map((k) => [k, row![k]]));
const cents = (n: unknown) => (typeof n === 'number' ? Math.round(n) / 100 : null);

/**
 * Everything the admin can see about one account: sign-in and settings, billing, team, agents, deals, listings, documents (file names),
 * invoices and commissions (amounts, no client names), usage counts, and the recent audit trail with IP addresses.
 * Never message text, document contents, client names or contact details.
 */
export async function loadAccountProfile(userId: string) {
  const { data: au } = await supabaseServer.auth.admin.getUserById(userId);
  const u = au.user;
  const meta = (u?.user_metadata || {}) as Row;
  const app = (u?.app_metadata || {}) as Row;
  const wf = Array.isArray(meta.due_date_workflow_steps) ? (meta.due_date_workflow_steps as { name?: string }[]).map((x) => x.name).filter(Boolean) : [];
  const account = {
    email: u?.email || null,
    name: (meta.full_name as string) || null,
    phone: u?.phone || (meta.phone as string) || null,
    createdAt: u?.created_at || null,
    emailConfirmedAt: u?.email_confirmed_at || null,
    lastSignInAt: u?.last_sign_in_at || null,
    providers: (u?.identities || []).map((i) => i.provider),
    twoStep: (u?.factors || []).some((f) => f.status === 'verified'),
    bannedUntil: (u as unknown as { banned_until?: string | null })?.banned_until || null,
    plan: app.plan || null,
    role: app.role || null,
    isAdmin: app.is_admin === true,
    agentWorkspace: app.agent_workspace === true,
    trialEndsAt: app.trial_ends_at || null,
    termsAcceptedAt: app.terms_accepted_at || null,
    termsVersion: app.terms_version || null,
    settings: {
      'Default flat fee': meta.default_flat_fee, 'Default percent fee': meta.default_percent_fee, 'Invoice due (days)': meta.invoice_due_days,
      'Payment preference': meta.payment_preference, 'Onboarding done': meta.onboarding_completed, 'First-run guide done': meta.first_run_guide_done,
      'Due-date workflow': meta.due_date_workflow_enabled ? `On (${wf.length} steps: ${wf.join(', ')})` : meta.due_date_workflow_enabled === false ? 'Off' : undefined,
      'States worked in': Array.isArray(meta.states) ? (meta.states as string[]).join(', ') : undefined,
      'Hints seen': Array.isArray(meta.seen_hints) ? (meta.seen_hints as string[]).join(', ') : undefined,
    },
  };

  const deals = await safe(() => supabaseServer.from('transactions').select('id, file_number, property_address, status, acceptance_date, closing_date, created_at, updated_at, agent_id').eq('tc_user_id', userId).order('created_at', { ascending: false }).limit(200));
  const ids = deals.map((d) => d.id as string);
  const inTx = (table: string, cols: string) => (ids.length ? safe(() => supabaseServer.from(table).select(cols).in('transaction_id', ids).limit(5000)) : Promise.resolve([] as Row[]));

  const [agents, listings, stripe, membership, linksAsOwner, linksAsAgent, tasks, keyDates, docs, msgs, clientMsgs, emails, signing, shares, contactsRows, templates, feed, notifs, ai, audit, commissions, txAgents, invites] = await Promise.all([
    safe(() => supabaseServer.from('agents').select('id, name, brokerage, email, phone, flat_fee, commission_percent, listing_fee, payment_method, source, created_at').eq('tc_user_id', userId).order('created_at', { ascending: false }).limit(200)),
    safe(() => supabaseServer.from('listings').select('id, property_address, status, listed_on, expiration_date, created_at, updated_at, agent_id').eq('tc_user_id', userId).order('created_at', { ascending: false }).limit(200)),
    safe(() => supabaseServer.from('stripe_customers').select('plan, subscription_status, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at').eq('user_id', userId).limit(1)),
    safe(() => supabaseServer.from('team_members').select('team_id, role, joined_at').eq('user_id', userId).limit(5)),
    safe(() => supabaseServer.from('brokerage_links').select('agent_user_id, invited_email, status, invited_at, responded_at, ended_at').eq('owner_user_id', userId).limit(200)),
    safe(() => supabaseServer.from('brokerage_links').select('owner_user_id, status, invited_at, responded_at, ended_at').eq('agent_user_id', userId).limit(20)),
    inTx('tasks', 'transaction_id, completed'),
    inTx('transaction_key_dates', 'transaction_id, label, due_date, completed'),
    inTx('documents', 'transaction_id, file_name, category, file_size, created_at, uploaded_by'),
    inTx('messages', 'transaction_id, sender_id, created_at'),
    inTx('client_messages', 'transaction_id, sender_type, created_at'),
    inTx('transaction_emails', 'transaction_id, received_at, created_at'),
    inTx('signing_requests', 'transaction_id, status, created_at'),
    inTx('external_access_links', 'transaction_id, scope, access_count, last_accessed_at, revoked_at, created_at'),
    safe(() => supabaseServer.from('contacts').select('contact_type, source, created_at').eq('tc_user_id', userId).limit(5000)),
    safe(() => supabaseServer.from('doc_templates').select('kind, archived, use_count').eq('owner_user_id', userId).limit(1000)),
    safe(() => supabaseServer.from('calendar_feed_tokens').select('created_at').eq('user_id', userId).limit(1)),
    safe(() => supabaseServer.from('notifications').select('read_at, created_at').eq('recipient_user_id', userId).limit(2000)),
    safe(() => supabaseServer.from('ai_usage').select('feature, input_tokens, output_tokens, created_at').eq('user_id', userId).limit(5000)),
    safe(() => supabaseServer.from('audit_log').select('action, created_at, ip, user_agent').eq('actor_id', userId).order('created_at', { ascending: false }).limit(60)),
    safe(() => supabaseServer.from('deal_commissions').select('transaction_id, statement_number, status, gross_cents, agent_net_cents, brokerage_net_cents, accepted_at, paid_on, updated_at').eq('owner_user_id', userId).limit(500)),
    inTx('transaction_agents', 'transaction_id, agent_user_id'),
    inTx('agent_invites', 'transaction_id, status, created_at, accepted_at'),
  ]);

  const agentIds = agents.map((a) => a.id as string);
  const invoices = agentIds.length ? await safe(() => supabaseServer.from('invoices').select('agent_id, transaction_id, listing_id, kind, invoice_number, invoice_date, amount_owed, paid, paid_amount, paid_at, sent_at, refunded_amount, created_at').in('agent_id', agentIds).order('created_at', { ascending: false }).limit(500)) : [];
  const teamRow = membership[0];
  const team = teamRow ? (await safe(() => supabaseServer.from('teams').select('id, name, owner_id, created_at').eq('id', teamRow.team_id as string).limit(1)))[0] : undefined;
  const teamMembers = team ? (await safe(() => supabaseServer.from('team_members').select('user_id, role').eq('team_id', team.id as string).limit(50))).length : 0;
  const agentName = new Map(agents.map((a) => [a.id as string, (a.name as string) || '']));
  const by = (rows: Row[]) => { const m = new Map<string, Row[]>(); for (const r of rows) { const k = r.transaction_id as string; (m.get(k) || m.set(k, []).get(k)!).push(r); } return m; };
  const tasksBy = by(tasks), docsBy = by(docs), msgsBy = by(msgs), keyBy = by(keyDates);
  const sum = (rows: Row[], k: string) => rows.reduce((n, r) => n + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
  const aiByFeature = new Map<string, { calls: number; tokens: number }>();
  for (const r of ai) { const f = (r.feature as string) || 'other'; const x = aiByFeature.get(f) || { calls: 0, tokens: 0 }; x.calls += 1; x.tokens += ((r.input_tokens as number) || 0) + ((r.output_tokens as number) || 0); aiByFeature.set(f, x); }
  const count = (rows: Row[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = String(r[key] ?? 'unknown'); m[k] = (m[k] || 0) + 1; } return m; };

  return {
    account,
    billing: { ...pick(stripe[0], ['plan', 'subscription_status', 'current_period_end', 'updated_at']), hasStripeCustomer: !!stripe[0]?.stripe_customer_id, hasSubscription: !!stripe[0]?.stripe_subscription_id },
    team: team ? { name: team.name, role: teamRow.role, joinedAt: teamRow.joined_at, members: teamMembers, isOwner: team.owner_id === userId } : null,
    brokerage: { asOwner: count(linksAsOwner, 'status'), asAgent: linksAsAgent.map((l) => pick(l, ['status', 'invited_at', 'responded_at', 'ended_at'])) },
    agents: agents.map((a) => ({ ...pick(a, ['name', 'brokerage', 'email', 'phone', 'flat_fee', 'commission_percent', 'listing_fee', 'payment_method', 'source', 'created_at']) })),
    deals: deals.map((d) => {
      const t = tasksBy.get(d.id as string) || [];
      const dk = keyBy.get(d.id as string) || [];
      return {
        ...pick(d, ['file_number', 'property_address', 'status', 'acceptance_date', 'closing_date', 'created_at', 'updated_at']),
        agent: agentName.get(d.agent_id as string) || null,
        steps: { done: t.filter((x) => x.completed).length, total: t.length },
        keyDates: { done: dk.filter((x) => x.completed).length, total: dk.length },
        documents: (docsBy.get(d.id as string) || []).length,
        messages: (msgsBy.get(d.id as string) || []).length,
      };
    }),
    listings: listings.map((l) => ({ ...pick(l, ['property_address', 'status', 'listed_on', 'expiration_date', 'created_at', 'updated_at']), agent: agentName.get(l.agent_id as string) || null })),
    documents: docs.map((d) => pick(d, ['file_name', 'category', 'file_size', 'created_at'])).slice(0, 200),
    invoices: {
      count: invoices.length, sent: invoices.filter((i) => i.sent_at).length, paid: invoices.filter((i) => i.paid).length,
      owed: sum(invoices, 'amount_owed'), collected: sum(invoices, 'paid_amount'), refunded: sum(invoices, 'refunded_amount'),
      recent: invoices.slice(0, 15).map((i) => ({ ...pick(i, ['invoice_number', 'kind', 'invoice_date', 'amount_owed', 'paid', 'sent_at']), agent: agentName.get(i.agent_id as string) || null })),
    },
    commissions: { count: commissions.length, byStatus: count(commissions, 'status'), grossDollars: cents(sum(commissions, 'gross_cents')), brokerageNetDollars: cents(sum(commissions, 'brokerage_net_cents')) },
    usage: {
      contacts: contactsRows.length, contactsByType: count(contactsRows, 'contact_type'),
      templates: templates.filter((t) => !t.archived).length, templateUses: sum(templates, 'use_count'),
      emailsReceived: emails.length, lastEmailAt: emails.map((e) => (e.received_at || e.created_at) as string).sort().pop() || null,
      messagesSent: msgs.filter((m) => m.sender_id === userId).length, messagesFromOthers: msgs.filter((m) => m.sender_id !== userId).length,
      clientMessages: clientMsgs.length, signingByStatus: count(signing, 'status'),
      shareLinks: shares.length, shareLinkViews: sum(shares, 'access_count'), lastShareViewAt: shares.map((x) => x.last_accessed_at as string).filter(Boolean).sort().pop() || null,
      calendarFeed: feed.length > 0, notifications: notifs.length, unreadNotifications: notifs.filter((n) => !n.read_at).length,
      agentLoginsOnDeals: new Set(txAgents.map((a) => a.agent_user_id as string)).size, agentInvites: count(invites, 'status'),
      ai: [...aiByFeature.entries()].map(([feature, v]) => ({ feature, ...v })),
    },
    audit: audit.map((a) => ({ action: a.action, at: a.created_at, ip: a.ip, device: String(a.user_agent || '').replace(/^Mozilla\/5\.0 /, '').slice(0, 70) })),
  };
}
