import { supabaseServer } from './supabase';
import { outboxOnly } from './dealEmail';
import { buildMergeContext, displayNameOf, loadDealForTemplates, recipientsOf, type DealForTemplates, type DealPerson } from './templateContext';
import { renderTemplate } from './templateMerge';
import { templateFitsState } from './usStates';

// Automatic rules for templates: "when a deal closes, draft this email for the buyer and seller". A rule never sends
// anything. It creates a draft (a template_run, status pending) that waits in the approvals list until the person
// reads it and approves it.

export { CATCH_UP_DAYS, addDays, addYears, dueDatesFor, isoDay } from './templateRuleDates';
export type { RuleShape, RuleTrigger } from './templateRuleDates';
import { addDays, dueDatesFor, isoDay, type RuleShape } from './templateRuleDates';

/** Who a rule's draft goes to: people on the deal with an email whose role matches. */
export function pickRecipients(deal: DealForTemplates, roles: string[]): DealPerson[] {
  const wanted = new Set(roles.map((r) => r.trim().toLowerCase()));
  const seen = new Set<string>();
  return recipientsOf(deal).filter((p) => {
    const email = p.email!.toLowerCase();
    if (seen.has(email) || !(wanted.has(p.category.toLowerCase()) || wanted.has(p.role.toLowerCase()))) return false;
    seen.add(email);
    return true;
  });
}

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

interface RuleRow extends RuleShape {
  id: string;
  owner_user_id: string;
  template_id: string;
  recipient_roles: string[];
}

/**
 * Makes any drafts that are due for one owner, for all their open and closed deals or just one deal. Safe to run as
 * often as you like: a draft already made (same rule, deal and date) is never made twice. Returns how many were added.
 */
export async function evaluateTemplateRules(ownerId: string, opts: { transactionId?: string; today?: string } = {}): Promise<number> {
  const today = opts.today ?? isoDay(new Date());
  const { data: rules } = await supabaseServer.from('template_rules').select('*').eq('owner_user_id', ownerId).eq('enabled', true);
  if (!rules || rules.length === 0) return 0;
  const templateIds = [...new Set(rules.map((r) => r.template_id as string))];
  const { data: templates } = await supabaseServer.from('doc_templates').select('*').in('id', templateIds).eq('owner_user_id', ownerId).eq('archived', false);
  const byId = new Map((templates || []).map((t) => [t.id as string, t]));

  let query = supabaseServer.from('transactions').select('id, status, closing_date, acceptance_date').eq('tc_user_id', ownerId).limit(3000);
  if (opts.transactionId) query = query.eq('id', opts.transactionId);
  const { data: deals } = await query;
  if (!deals || deals.length === 0) return 0;

  const { data: user } = await supabaseServer.auth.admin.getUserById(ownerId);
  const me = { name: user.user ? displayNameOf(user.user) : 'Your transaction coordinator', email: user.user?.email ?? null };

  const dealIds = deals.map((d) => d.id as string);
  const { data: existing } = await supabaseServer.from('template_runs').select('rule_id, transaction_id, due_on').eq('owner_user_id', ownerId).in('transaction_id', dealIds);
  const ran = new Map<string, string[]>(); // "rule|deal" -> due dates already drafted
  for (const r of existing || []) {
    const key = `${r.rule_id}|${r.transaction_id}`;
    ran.set(key, [...(ran.get(key) ?? []), r.due_on as string]);
  }

  let added = 0;
  const loaded = new Map<string, DealForTemplates | null>();
  for (const deal of deals) {
    for (const rule of rules as RuleRow[]) {
      const template = byId.get(rule.template_id);
      if (!template) continue;
      const done = ran.get(`${rule.id}|${deal.id}`) ?? [];
      // "When the deal closes" is anchored on the day it was first noticed, so later checks reuse that day.
      const knownAnchor = rule.trigger_event === 'deal_closed' && done.length > 0 ? addDays([...done].sort()[0], -rule.offset_days) : null;
      const due = dueDatesFor(rule, { status: deal.status as string, closingDate: deal.closing_date as string | null, acceptanceDate: deal.acceptance_date as string | null }, today, knownAnchor).filter((d) => !done.includes(d));
      if (due.length === 0) continue;

      if (!loaded.has(deal.id as string)) loaded.set(deal.id as string, await loadDealForTemplates(deal.id as string));
      const full = loaded.get(deal.id as string);
      if (!full || !templateFitsState(template.states as string[], full.state)) continue;
      const recipients = rule.recipient_roles.length ? pickRecipients(full, rule.recipient_roles) : [];
      const ctx = buildMergeContext(full, me, recipients[0] ?? null, parse(today));
      const subject = renderTemplate(template.subject as string | null, ctx).text;
      const body = renderTemplate(template.body as string | null, ctx).text;

      for (const dueOn of due) {
        const { error } = await supabaseServer.from('template_runs').insert({
          owner_user_id: ownerId,
          rule_id: rule.id,
          template_id: template.id,
          transaction_id: deal.id,
          due_on: dueOn,
          status: 'pending',
          kind: template.kind,
          subject: template.kind === 'form' ? null : subject,
          body: template.kind === 'form' ? null : body,
          recipients: recipients.map((p) => ({ name: p.name, email: p.email, role: p.role || p.category })),
          outbox_only: outboxOnly(),
        });
        if (!error) added++;
        else if (error.code !== '23505') console.error('template run not created:', error);
      }
    }
  }
  return added;
}

/** Best-effort wrapper for use inside other requests: never throws, never slows the caller by more than the check. */
export async function evaluateTemplateRulesQuietly(ownerId: string, transactionId?: string): Promise<void> {
  try {
    await evaluateTemplateRules(ownerId, { transactionId });
  } catch (error) {
    console.error('template rules check failed:', error);
  }
}

/** Everyone's drafts. Run once a day from a cron job; returns how many people were checked, drafts added, and failures. */
export async function evaluateAllTemplateRules(): Promise<{ owners: number; drafts: number; failed: number }> {
  const { data: rows, error } = await supabaseServer.from('template_rules').select('owner_user_id').eq('enabled', true).limit(5000);
  if (error) throw error;
  const owners = [...new Set((rows || []).map((r) => r.owner_user_id as string))];
  let drafts = 0;
  let failed = 0;
  for (const owner of owners) {
    try {
      drafts += await evaluateTemplateRules(owner);
    } catch (e) {
      failed++;
      console.error('template rules failed for one person:', e);
    }
  }
  return { owners: owners.length, drafts, failed };
}
