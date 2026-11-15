import { supabaseServer } from './supabase';
import { CLOSED_STAGE, agentLabels, closedWithoutCommission, listOwnerLinks, loadOversightDeals, closedOnDate } from './oversight';
import { sendBrokerageEmail } from './oversightServer';
import { inReviewWindow, missingRequired, requiredForDeal, type DocumentList } from './fileReview';
import {
  agentNoticeText, closingFlags, cleanParams, digestText, documentFlags, lateStepFlags, monthlyText, ownerAlertText, paramNumber, quietAgents, stalledFlags, welcomeText,
  daysBetween, defOf, type AutomationKind, type DealLite, type Flag,
} from './brokerageAutomationRules';

// The runner for brokerage automations: for each owner, each rule they have switched on is checked and the right people are told once.
// "Once" is kept in brokerage_automation_alerts: a file already told about is not told again unless it changes. Never throws for one
// owner's problem; the rest still run. Rules and wording live in brokerageAutomationRules.ts.

export interface AutomationConfig { kind: AutomationKind; enabled: boolean; params: Record<string, unknown>; agentIds: string[]; notifyAgents: boolean }
export interface RunResult { kind: AutomationKind; status: 'ok' | 'nothing' | 'failed'; flagged: number; emails: number; summary: string }

const missingTable = (e: { code?: string } | null | undefined) => e?.code === 'PGRST205' || e?.code === '42P01';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sentOk = (r: string) => r === 'sent' || r === 'outbox';

/** The owner's settings for every rule; a rule with no row is off. */
export async function loadConfigs(ownerId: string): Promise<Map<AutomationKind, AutomationConfig>> {
  const { data, error } = await supabaseServer.from('brokerage_automations').select('kind, enabled, params, agent_ids, notify_agents').eq('owner_user_id', ownerId);
  if (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
  return new Map((data ?? []).map((r) => [r.kind as AutomationKind, { kind: r.kind as AutomationKind, enabled: r.enabled === true, params: (r.params as Record<string, unknown>) ?? {}, agentIds: (r.agent_ids as string[]) ?? [], notifyAgents: r.notify_agents !== false }]));
}

/** True the first time this item is seen for this rule; false when it was already told. */
async function claim(ownerId: string, kind: string, key: string): Promise<boolean> {
  const { error } = await supabaseServer.from('brokerage_automation_alerts').insert({ owner_user_id: ownerId, kind, item_key: key });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

/** Items told to the agent at least `days` days ago, not yet escalated, whose key is still in `keys`; marks them escalated. */
async function dueForEscalation(ownerId: string, kind: string, keys: Set<string>, days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabaseServer.from('brokerage_automation_alerts').select('item_key').eq('owner_user_id', ownerId).eq('kind', kind).is('escalated_at', null).lte('notified_at', cutoff).limit(2000);
  if (error) throw error;
  const due = (data ?? []).map((r) => r.item_key as string).filter((k) => keys.has(k));
  if (due.length) {
    const { error: upErr } = await supabaseServer.from('brokerage_automation_alerts').update({ escalated_at: new Date().toISOString() }).eq('owner_user_id', ownerId).eq('kind', kind).in('item_key', due);
    if (upErr) throw upErr;
  }
  return new Set(due);
}

interface Ctx {
  ownerId: string;
  ownerName: string;
  today: string;
  agentIds: string[];
  names: Map<string, string>;
  deals: DealLite[];
  allDeals: (DealLite & { purchase_price: number | string | null; checklist_template_name?: string | null; file_number: string | null })[];
}

const nameOf = (c: Ctx, id: string) => c.names.get(id) ?? 'Agent';
const group = <T extends { agentId: string }>(items: T[]) => {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(i.agentId, [...(m.get(i.agentId) ?? []), i]);
  return m;
};

async function toAgent(c: Ctx, agentId: string, source: string, text: { subject: string; paragraphs: string[] }): Promise<number> {
  return sentOk(await sendBrokerageEmail({ outboxOwnerId: c.ownerId, fromLabel: c.ownerName, to: { userId: agentId }, source, subject: text.subject, paragraphs: text.paragraphs, path: '/dashboard/transactions', linkLabel: 'Open your deals' })) ? 1 : 0;
}
async function toOwner(c: Ctx, source: string, text: { subject: string; paragraphs: string[] }, path = '/dashboard/compliance'): Promise<number> {
  return sentOk(await sendBrokerageEmail({ outboxOwnerId: c.ownerId, fromLabel: 'Relay TC', to: { userId: c.ownerId }, source, subject: text.subject, paragraphs: text.paragraphs, path, linkLabel: 'Open Relay' })) ? 1 : 0;
}

/** Tell the agent first (when allowed), and the owner once it is still unresolved after `escalateDays`; with agent notices off, the owner hears at once. */
async function agentThenOwner(c: Ctx, kind: AutomationKind, cfg: AutomationConfig, flags: Flag[], agentKind: 'stalled' | 'documents', ownerTitle: string, escalateDays: number): Promise<{ flagged: number; emails: number; summary: string }> {
  const fresh: Flag[] = [];
  for (const f of flags) if (await claim(c.ownerId, kind, f.key)) fresh.push(f);
  let emails = 0;
  if (cfg.notifyAgents) for (const [agentId, list] of group(fresh)) emails += await toAgent(c, agentId, `brokerage_${kind}`, agentNoticeText(agentKind, list));
  const escalate = cfg.notifyAgents ? flags.filter((f) => !fresh.includes(f)) : fresh;
  const due = cfg.notifyAgents ? await dueForEscalation(c.ownerId, kind, new Set(escalate.map((f) => f.key)), escalateDays) : new Set(escalate.map((f) => f.key));
  const forOwner = escalate.filter((f) => due.has(f.key)).map((f) => ({ ...f, agentName: nameOf(c, f.agentId) }));
  if (forOwner.length) emails += await toOwner(c, `brokerage_${kind}`, ownerAlertText(ownerTitle, forOwner));
  return { flagged: fresh.length + forOwner.length, emails, summary: fresh.length + forOwner.length === 0 ? 'Nothing new to flag.' : `${plural(fresh.length, 'new file')} flagged${cfg.notifyAgents ? ' to agents' : ''}; ${plural(forOwner.length, 'file')} sent to you.` };
}

async function runOne(c: Ctx, cfg: AutomationConfig): Promise<{ flagged: number; emails: number; summary: string }> {
  const { kind, params } = cfg;
  const inScope = (id: string) => cfg.agentIds.length === 0 || cfg.agentIds.includes(id);
  const deals = c.deals.filter((d) => inScope(d.tc_user_id));

  if (kind === 'stalled') {
    return agentThenOwner(c, kind, cfg, stalledFlags(deals, c.today, paramNumber(kind, params, 'days')), 'stalled', 'Stalled deals', paramNumber(kind, params, 'escalateDays'));
  }

  if (kind === 'documents') {
    const [reqRes, listsRes] = await Promise.all([
      supabaseServer.from('brokerage_file_requirements').select('document_types').eq('owner_user_id', c.ownerId).maybeSingle(),
      supabaseServer.from('brokerage_document_lists').select('name, template_names, document_types').eq('owner_user_id', c.ownerId).order('position', { ascending: true }),
    ]);
    if (reqRes.error) throw reqRes.error;
    if (listsRes.error && !missingTable(listsRes.error)) throw listsRes.error;
    const lists: DocumentList[] = (listsRes.data ?? []).map((r) => ({ name: r.name as string, templateNames: (r.template_names as string[]) ?? [], documentTypes: (r.document_types as string[]) ?? [] }));
    const required = ((reqRes.data?.document_types as string[] | undefined) ?? []).slice();
    if (required.length === 0 && lists.length === 0) return { flagged: 0, emails: 0, summary: 'No required documents are set yet. Choose them under Compliance.' };
    const listed = c.allDeals.filter((d) => inScope(d.tc_user_id) && inReviewWindow(d, CLOSED_STAGE, c.today));
    const missing = new Map<string, string[]>();
    for (let i = 0; i < listed.length; i += 80) {
      const part = listed.slice(i, i + 80);
      const { data, error } = await supabaseServer.from('documents').select('transaction_id, document_type').in('transaction_id', part.map((d) => d.id));
      if (error) throw error;
      const byDeal = new Map<string, { document_type: string | null }[]>();
      for (const r of data ?? []) byDeal.set(r.transaction_id as string, [...(byDeal.get(r.transaction_id as string) ?? []), { document_type: r.document_type as string | null }]);
      for (const d of part) {
        const m = missingRequired(requiredForDeal(d.checklist_template_name ?? null, lists, required).required, byDeal.get(d.id) ?? []);
        if (m.length) missing.set(d.id, m);
      }
    }
    return agentThenOwner(c, kind, cfg, documentFlags(listed, missing), 'documents', 'Files missing documents', paramNumber(kind, params, 'escalateDays'));
  }

  if (kind === 'deadlines') {
    const flags = closingFlags(deals, c.today, paramNumber(kind, params, 'closingDays'));
    const fresh: Flag[] = [];
    for (const f of flags) if (await claim(c.ownerId, kind, f.key)) fresh.push(f);
    let emails = 0;
    if (cfg.notifyAgents) for (const [agentId, list] of group(fresh)) emails += await toAgent(c, agentId, 'brokerage_deadlines', agentNoticeText('closing', list));
    if (fresh.length) emails += await toOwner(c, 'brokerage_deadlines', ownerAlertText('Closings coming up', fresh.map((f) => ({ ...f, agentName: nameOf(c, f.agentId) }))), '/dashboard/transactions');
    const late = [];
    for (const l of lateStepFlags(deals, c.today, paramNumber(kind, params, 'lateSteps'))) if (await claim(c.ownerId, kind, l.key)) late.push(l);
    if (late.length) emails += await toOwner(c, 'brokerage_deadlines', { subject: `${plural(late.length, 'agent')} behind on steps`, paragraphs: [late.map((l) => `${nameOf(c, l.agentId)}: ${plural(l.late, 'step')} overdue`).join('\n')] }, '/dashboard/collaborate#agents');
    const n = fresh.length + late.length;
    return { flagged: n, emails, summary: n === 0 ? 'Nothing new to flag.' : `${plural(fresh.length, 'closing')} and ${plural(late.length, 'agent')} behind flagged.` };
  }

  if (kind === 'digest') {
    if (!(await claim(c.ownerId, kind, `digest:${c.today}`))) return { flagged: 0, emails: 0, summary: 'Today’s digest was already sent.' };
    const yesterday = new Date(Date.parse(`${c.today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const stalled = stalledFlags(deals, c.today, 5).map((f) => ({ address: f.address, agentName: nameOf(c, f.agentId), reason: f.reason }));
    const late = deals.filter((d) => d.status !== CLOSED_STAGE && d.health.overdueTasks > 0 && d.closing_date && daysBetween(c.today, String(d.closing_date).slice(0, 10)) <= 14).map((d) => ({ address: d.property_address || 'A deal', agentName: nameOf(c, d.tc_user_id), reason: `${plural(d.health.overdueTasks, 'step')} overdue, closing soon` }));
    const text = digestText({
      needsAttention: [...late, ...stalled.filter((s) => !late.some((l) => l.address === s.address && l.agentName === s.agentName))],
      closing: closingFlags(deals, c.today, 7).map((f) => ({ address: f.address, agentName: nameOf(c, f.agentId), date: f.reason })),
      lateAgents: lateStepFlags(deals, c.today, 0).map((l) => ({ name: nameOf(c, l.agentId), late: l.late })).sort((a, b) => b.late - a.late).slice(0, 8),
      quiet: quietAgents(cfg.agentIds.length ? cfg.agentIds : c.agentIds, c.allDeals, c.today, paramNumber(kind, params, 'quietDays')).map((id) => nameOf(c, id)),
      newDeals: deals.filter((d) => (d.acceptance_date ?? '').slice(0, 10) === yesterday).map((d) => ({ address: d.property_address || 'A deal', agentName: nameOf(c, d.tc_user_id) })),
    });
    if (!text) return { flagged: 0, emails: 0, summary: 'Nothing to report today, so no email was sent.' };
    return { flagged: 1, emails: await toOwner(c, 'brokerage_daily_digest', text, '/dashboard'), summary: 'Digest sent.' };
  }

  if (kind === 'onboarding') {
    const since = new Date(Date.parse(`${c.today}T00:00:00Z`) - 3 * 86400000).toISOString();
    const links = (await listOwnerLinks(c.ownerId)).filter((l) => l.status === 'active' && l.agent_user_id && inScope(l.agent_user_id) && (l.responded_at ?? '') >= since);
    const message = typeof params.message === 'string' ? params.message : '';
    let emails = 0;
    const joined: string[] = [];
    for (const l of links) {
      const id = l.agent_user_id as string;
      if (!(await claim(c.ownerId, kind, `agent:${id}`))) continue;
      joined.push(nameOf(c, id));
      if (cfg.notifyAgents) emails += await toAgent(c, id, 'brokerage_onboarding', welcomeText(c.ownerName, message));
    }
    if (joined.length) emails += await toOwner(c, 'brokerage_onboarding', { subject: `${plural(joined.length, 'agent')} joined`, paragraphs: [`${joined.join(', ')} ${joined.length === 1 ? 'has' : 'have'} joined and ${cfg.notifyAgents ? 'received your welcome message' : 'can now be seen in your agents list'}.`] }, '/dashboard/collaborate#agents');
    return { flagged: joined.length, emails, summary: joined.length ? `Welcomed ${joined.join(', ')}.` : 'No new agents.' };
  }

  // reporting: on the first run of a new month, last month's closings and any with no commission recorded
  const thisMonth = c.today.slice(0, 7);
  if (!(await claim(c.ownerId, kind, `month:${thisMonth}`))) return { flagged: 0, emails: 0, summary: 'This month’s report was already sent.' };
  const start = new Date(Date.parse(`${thisMonth}-01T00:00:00Z`));
  start.setUTCMonth(start.getUTCMonth() - 1);
  const prev = start.toISOString().slice(0, 7);
  const mine = c.allDeals.filter((d) => inScope(d.tc_user_id) && d.status === CLOSED_STAGE && closedOnDate(d, c.today).slice(0, 7) === prev);
  const { data, error } = await supabaseServer.from('deal_commissions').select('transaction_id, status').eq('owner_user_id', c.ownerId).limit(5000);
  if (error && !missingTable(error)) throw error;
  const have = new Set((data ?? []).filter((r) => r.status !== 'void').map((r) => r.transaction_id as string));
  const missing = closedWithoutCommission(mine, have, c.today, 120).map((d) => ({ address: d.property_address || 'A deal', agentName: nameOf(c, d.tc_user_id) }));
  const volume = mine.reduce((n, d) => n + (Number(d.purchase_price) || 0), 0);
  const label = new Date(`${prev}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { flagged: mine.length, emails: await toOwner(c, 'brokerage_monthly_report', monthlyText(label, { closed: mine.length, volume, withoutCommission: missing }), '/dashboard/reports'), summary: `${label}: ${plural(mine.length, 'closing')}.` };
}

/** Runs the rules this owner has switched on (or only `only`, for "Run now"). Records each run. */
export async function runForOwner(ownerId: string, today: string, only?: AutomationKind): Promise<RunResult[]> {
  const configs = [...(await loadConfigs(ownerId)).values()].filter((c) => (only ? c.kind === only : c.enabled));
  if (configs.length === 0) return [];
  const links = (await listOwnerLinks(ownerId)).filter((l) => l.status === 'active' && l.agent_user_id);
  const agentIds = links.map((l) => l.agent_user_id as string);
  const [labels, ownerLabel, rawDeals] = await Promise.all([agentLabels(agentIds), agentLabels([ownerId]), loadOversightDeals(agentIds, today)]);
  // Archived deals are out of everyday work, so they are never flagged.
  const archived = new Set<string>();
  for (let i = 0; i < rawDeals.length; i += 80) {
    const { data } = await supabaseServer.from('transactions').select('id').in('id', rawDeals.slice(i, i + 80).map((d) => d.id)).not('archived_at', 'is', null);
    for (const r of data ?? []) archived.add(r.id as string);
  }
  const allDeals = rawDeals.filter((d) => !archived.has(d.id)) as Ctx['allDeals'];
  const ctx: Ctx = { ownerId, ownerName: ownerLabel.get(ownerId)?.name ?? 'Your brokerage', today, agentIds, names: new Map([...labels].map(([id, l]) => [id, l.name])), deals: allDeals, allDeals };

  const results: RunResult[] = [];
  for (const cfg of configs) {
    let r: RunResult;
    try {
      const out = await runOne(ctx, cfg);
      r = { kind: cfg.kind, status: out.flagged > 0 || out.emails > 0 ? 'ok' : 'nothing', ...out };
    } catch (error) {
      console.error(`Brokerage automation ${cfg.kind} failed:`, error);
      r = { kind: cfg.kind, status: 'failed', flagged: 0, emails: 0, summary: 'Something went wrong. It will try again next time.' };
    }
    await supabaseServer.from('brokerage_automation_runs').insert({ owner_user_id: ownerId, kind: r.kind, status: r.status, flagged: r.flagged, emails: r.emails, summary: r.summary.slice(0, 300) });
    results.push(r);
  }
  return results;
}

/** The daily job: every owner with at least one rule switched on. */
export async function runAllBrokerageAutomations(today: string): Promise<{ owners: number; runs: number; emails: number }> {
  const { data, error } = await supabaseServer.from('brokerage_automations').select('owner_user_id').eq('enabled', true).limit(5000);
  if (error) {
    if (missingTable(error)) return { owners: 0, runs: 0, emails: 0 };
    throw error;
  }
  const owners = [...new Set((data ?? []).map((r) => r.owner_user_id as string))];
  let runs = 0, emails = 0;
  for (const ownerId of owners) {
    try {
      const res = await runForOwner(ownerId, today);
      runs += res.length;
      emails += res.reduce((n, r) => n + r.emails, 0);
    } catch (e) {
      console.error('Brokerage automations failed for one owner:', e);
    }
  }
  return { owners: owners.length, runs, emails };
}

/** Owners who have the daily digest on skip the Monday email, so nobody gets both. */
export async function ownersWithDailyDigest(): Promise<Set<string>> {
  const { data, error } = await supabaseServer.from('brokerage_automations').select('owner_user_id').eq('kind', 'digest').eq('enabled', true).limit(5000);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.owner_user_id as string));
}

export { cleanParams, defOf };
