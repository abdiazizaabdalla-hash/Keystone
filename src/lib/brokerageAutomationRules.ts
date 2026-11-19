import { CLOSED_STAGE } from './oversightMath';

// Brokerage automations: what each rule is, what a broker can adjust, and the pure checks that decide what to flag.
// Fixed triggers and conditions, no AI. Pure (no database), so it can be unit tested. The runner is brokerageAutomations.ts.

export const AUTOMATION_KINDS = ['stalled', 'deadlines', 'documents', 'digest', 'onboarding', 'reporting'] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];
export const isAutomationKind = (v: unknown): v is AutomationKind => (AUTOMATION_KINDS as readonly string[]).includes(String(v));

export interface ParamDef { key: string; label: string; unit?: string; min: number; max: number; default: number }
export interface AutomationDef {
  kind: AutomationKind;
  name: string;
  /** One line: what it does for the broker. */
  blurb: string;
  trigger: string;
  action: string;
  params: ParamDef[];
  /** Whether the rule can tell the agent as well as the broker. */
  agentNotice: boolean;
  /** Free text the broker writes (the welcome message). */
  hasMessage?: boolean;
}

export const AUTOMATIONS: AutomationDef[] = [
  {
    kind: 'stalled', name: 'Stalled deal alerts', agentNotice: true,
    blurb: 'Catch deals that have gone quiet before they fall through the cracks.',
    trigger: 'An open deal has had no change for several days',
    action: 'Tell the agent; if it is still quiet a few days later, tell you',
    params: [
      { key: 'days', label: 'Quiet for', unit: 'days', min: 2, max: 30, default: 5 },
      { key: 'escalateDays', label: 'Then tell me after', unit: 'more days', min: 1, max: 14, default: 2 },
    ],
  },
  {
    kind: 'deadlines', name: 'Closing and deadline alerts', agentNotice: true,
    blurb: 'Closings never sneak up on you, and an agent falling behind is flagged.',
    trigger: 'A closing is near, or an agent has many overdue steps',
    action: 'Tell the agent and you about the closing; tell you about the late steps',
    params: [
      { key: 'closingDays', label: 'Closing within', unit: 'days', min: 1, max: 30, default: 7 },
      { key: 'lateSteps', label: 'Agent has more than', unit: 'overdue steps', min: 1, max: 30, default: 5 },
    ],
  },
  {
    kind: 'documents', name: 'Missing document checks', agentNotice: true,
    blurb: 'Files closing soon or already closed are checked against your required-document lists.',
    trigger: 'A file is missing a document you require',
    action: 'Tell the agent; if it is still missing a few days later, tell you',
    params: [{ key: 'escalateDays', label: 'Then tell me after', unit: 'days', min: 1, max: 14, default: 3 }],
  },
  {
    kind: 'digest', name: 'Daily brokerage digest', agentNotice: false,
    blurb: 'One morning email: what needs attention, what closes soon, who is behind.',
    trigger: 'Every morning',
    action: 'Email you a summary (and nothing on days there is nothing to say)',
    params: [{ key: 'quietDays', label: 'Flag agents with no deals for', unit: 'days', min: 14, max: 365, default: 60 }],
  },
  {
    kind: 'onboarding', name: 'New agent onboarding', agentNotice: true,
    blurb: 'Every agent who joins gets the same welcome and the same first steps.',
    trigger: 'An agent joins your brokerage',
    action: 'Send the agent your welcome message and how to start; tell you who joined',
    params: [],
    hasMessage: true,
  },
  {
    kind: 'reporting', name: 'Monthly closing and commission report', agentNotice: false,
    blurb: 'On the 1st: last month’s closed volume, and closings with no commission recorded.',
    trigger: 'A new month starts',
    action: 'Email you last month’s numbers',
    params: [],
  },
];

/** A TC team gets the rules that make sense for coordinators (status only: no document checks, no commissions, no agents joining). */
export const TEAM_KINDS: AutomationKind[] = ['stalled', 'deadlines', 'digest', 'reporting'];
export const kindsFor = (mode: 'brokerage' | 'team'): AutomationKind[] => (mode === 'team' ? TEAM_KINDS : [...AUTOMATION_KINDS]);
export const triggersFor = (mode: 'brokerage' | 'team') => (mode === 'team' ? (WORKFLOW_TRIGGERS as readonly WorkflowTrigger[]).filter((t) => t !== 'missing_docs') : [...WORKFLOW_TRIGGERS]);

export const defOf = (kind: AutomationKind) => AUTOMATIONS.find((a) => a.kind === kind) as AutomationDef;

export const MESSAGE_MAX = 1000;

export function defaultParams(kind: AutomationKind): Record<string, number> {
  return Object.fromEntries(defOf(kind).params.map((p) => [p.key, p.default]));
}

/** The settings a person sent, kept to the rule's own numbers, each within its range. Anything else is dropped. */
export function cleanParams(kind: AutomationKind, input: unknown): Record<string, number | string> {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: Record<string, number | string> = {};
  for (const p of defOf(kind).params) {
    const n = Number(raw[p.key]);
    out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, Math.round(n))) : p.default;
  }
  if (defOf(kind).hasMessage) out.message = typeof raw.message === 'string' ? raw.message.trim().slice(0, MESSAGE_MAX) : '';
  return out;
}

export function paramNumber(kind: AutomationKind, params: Record<string, unknown> | null | undefined, key: string): number {
  const def = defOf(kind).params.find((p) => p.key === key);
  const n = Number(params?.[key]);
  return Number.isFinite(n) && def ? Math.min(def.max, Math.max(def.min, n)) : (def?.default ?? 0);
}

// ---- Checks ----

export interface DealLite {
  id: string;
  tc_user_id: string;
  property_address: string | null;
  status: string | null;
  closing_date: string | null;
  acceptance_date: string | null;
  updated_at: string | null;
  health: { overdueTasks: number };
}
export interface Flag { key: string; agentId: string; dealId: string | null; address: string; reason: string }

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000);
const addDays = (iso: string, n: number) => new Date((dayNumber(iso) + n) * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const place = (d: Pick<DealLite, 'property_address'>) => d.property_address || 'A deal';
const open = (d: Pick<DealLite, 'status'>) => d.status !== CLOSED_STAGE;

/** Open deals with no change for `days` days. The key includes the last change, so a deal that moves and goes quiet again is flagged again. */
export function stalledFlags(deals: DealLite[], today: string, days: number): Flag[] {
  return deals
    .filter((d) => open(d) && d.updated_at && daysBetween(d.updated_at, today) >= days)
    .map((d) => ({ key: `${d.id}:${String(d.updated_at).slice(0, 10)}`, agentId: d.tc_user_id, dealId: d.id, address: place(d), reason: `No change for ${daysBetween(String(d.updated_at), today)} days` }));
}

/** Open deals closing within `days` days (today included). */
export function closingFlags(deals: DealLite[], today: string, days: number): Flag[] {
  const end = addDays(today, days);
  return deals
    .filter((d) => open(d) && d.closing_date && d.closing_date.slice(0, 10) >= today && d.closing_date.slice(0, 10) <= end)
    .map((d) => {
      const left = daysBetween(today, String(d.closing_date));
      return { key: `${d.id}:${String(d.closing_date).slice(0, 10)}`, agentId: d.tc_user_id, dealId: d.id, address: place(d), reason: left === 0 ? 'Closes today' : `Closes in ${left} day${left === 1 ? '' : 's'}${d.health.overdueTasks > 0 ? `, ${d.health.overdueTasks} step${d.health.overdueTasks === 1 ? '' : 's'} late` : ''}` };
    });
}

/** Agents whose open deals together have more than `limit` overdue steps. One flag per agent per week. */
export function lateStepFlags(deals: DealLite[], today: string, limit: number): { key: string; agentId: string; late: number }[] {
  const week = Math.floor(dayNumber(today) / 7);
  const byAgent = new Map<string, number>();
  for (const d of deals) if (open(d)) byAgent.set(d.tc_user_id, (byAgent.get(d.tc_user_id) ?? 0) + d.health.overdueTasks);
  return [...byAgent].filter(([, n]) => n > limit).map(([agentId, late]) => ({ key: `late:${agentId}:${week}`, agentId, late }));
}

/** Files (closing within 30 days or closed in the last 180) missing a required document. `missingByDeal` maps a deal to what it lacks. */
export function documentFlags(deals: DealLite[], missingByDeal: Map<string, string[]>): Flag[] {
  return deals
    .filter((d) => (missingByDeal.get(d.id) ?? []).length > 0)
    .map((d) => {
      const m = missingByDeal.get(d.id) as string[];
      return { key: `${d.id}:${m.slice().sort().join('|')}`, agentId: d.tc_user_id, dealId: d.id, address: place(d), reason: `Missing ${m.slice(0, 3).join(', ')}${m.length > 3 ? ` and ${m.length - 3} more` : ''}` };
    });
}

/** Active agents with no open deals and no change on any deal for `quietDays` days. */
export function quietAgents(agentIds: string[], deals: DealLite[], today: string, quietDays: number): string[] {
  return agentIds.filter((id) => {
    const mine = deals.filter((d) => d.tc_user_id === id);
    if (mine.some(open)) return false;
    const latest = mine.map((d) => d.updated_at).filter((x): x is string => !!x).sort().pop();
    return latest ? daysBetween(latest, today) >= quietDays : false;
  });
}

// ---- Wording ----

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lines = (flags: Pick<Flag, 'address' | 'reason'>[], name?: (i: number) => string) => flags.slice(0, 12).map((f, i) => `${f.address}${name ? ` (${name(i)})` : ''}: ${f.reason}`).join('\n') + (flags.length > 12 ? `\n…and ${flags.length - 12} more.` : '');

export function agentNoticeText(kind: 'stalled' | 'closing' | 'documents', flags: Flag[], org: 'brokerage' | 'team' = 'brokerage'): { subject: string; paragraphs: string[] } {
  const n = flags.length;
  const who = org === 'team' ? 'Your team owner' : 'Your brokerage';
  if (kind === 'stalled') return { subject: `${plural(n, 'deal')} ${n === 1 ? 'has' : 'have'} gone quiet`, paragraphs: [`${who} noticed these deals have had no activity for a while. Update the file or the checklist if something is moving.`, lines(flags)] };
  if (kind === 'closing') return { subject: `${plural(n, 'closing')} coming up`, paragraphs: ['These deals close soon. Make sure every step and document is ready.', lines(flags)] };
  return { subject: `${plural(n, 'file')} missing required documents`, paragraphs: ['Your brokerage requires documents that are not on these files yet.', lines(flags)] };
}

export function ownerAlertText(title: string, flags: (Flag & { agentName: string })[]): { subject: string; paragraphs: string[] } {
  return { subject: `${title}: ${plural(flags.length, 'file')}`, paragraphs: [lines(flags, (i) => flags[i].agentName)] };
}

export interface DigestInput {
  needsAttention: { address: string; agentName: string; reason: string }[];
  closing: { address: string; agentName: string; date: string }[];
  lateAgents: { name: string; late: number }[];
  quiet: string[];
  newDeals: { address: string; agentName: string }[];
}

/** The daily digest, or null when there is nothing to say. */
export function digestText(d: DigestInput, org: 'brokerage' | 'team' = 'brokerage'): { subject: string; paragraphs: string[] } | null {
  const total = d.needsAttention.length + d.closing.length + d.lateAgents.length + d.quiet.length + d.newDeals.length;
  if (total === 0) return null;
  const out: string[] = [];
  if (d.needsAttention.length) out.push(`Needs attention (${d.needsAttention.length}):\n${d.needsAttention.slice(0, 10).map((x) => `${x.address} (${x.agentName}): ${x.reason}`).join('\n')}`);
  if (d.closing.length) out.push(`Closing in the next 7 days (${d.closing.length}):\n${d.closing.slice(0, 10).map((x) => `${x.address} (${x.agentName}): ${x.date}`).join('\n')}`);
  if (d.lateAgents.length) out.push(`Overdue steps:\n${d.lateAgents.map((x) => `${x.name}: ${plural(x.late, 'step')} overdue`).join('\n')}`);
  if (d.newDeals.length) out.push(`Opened yesterday (${d.newDeals.length}):\n${d.newDeals.slice(0, 10).map((x) => `${x.address} (${x.agentName})`).join('\n')}`);
  if (d.quiet.length) out.push(`No deals for a while: ${d.quiet.join(', ')}`);
  const attention = d.needsAttention.length + d.lateAgents.length;
  const lead = org === 'team' ? 'Your team today' : 'Your brokerage today';
  return { subject: attention > 0 ? `${lead}: ${plural(attention, 'thing')} need${attention === 1 ? 's' : ''} you` : lead, paragraphs: out };
}

export function welcomeText(brokerage: string, message: string): { subject: string; paragraphs: string[] } {
  return {
    subject: `Welcome to ${brokerage}`,
    paragraphs: [message.trim() || `Welcome to ${brokerage}. Your deals now show up for your broker, so they can see where every file stands without chasing you.`, 'To start: open Transactions, add your first deal, and the checklist guides you from there.'],
  };
}

export function monthlyText(monthLabel: string, r: { closed: number; volume: number; withoutCommission: { address: string; agentName: string }[] }): { subject: string; paragraphs: string[] } {
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const out = [`${monthLabel}: ${plural(r.closed, 'deal')} closed, ${money(r.volume)} in sales volume.`];
  if (r.withoutCommission.length) out.push(`Closed with no commission recorded (${r.withoutCommission.length}):\n${r.withoutCommission.slice(0, 12).map((x) => `${x.address} (${x.agentName})`).join('\n')}`);
  else out.push('Every recent closing has a commission recorded.');
  return { subject: `${monthLabel} closing report`, paragraphs: out };
}

// ---- Workflows a broker builds (or adds from the template library) ----

export const WORKFLOW_TRIGGERS = ['quiet', 'closing', 'late_steps', 'missing_docs', 'new_deal', 'closed'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];
export const OWNER_MODES = ['escalate', 'now', 'never'] as const;
export type OwnerMode = (typeof OWNER_MODES)[number];
export const MAX_WORKFLOWS = 20;
export const WORKFLOW_NAME_MAX = 80;

export interface TriggerDef { id: WorkflowTrigger; label: string; /** Sentence the number completes, or null when the trigger has no number. */ amountLabel: string | null; unit?: string; min: number; max: number; default: number; agentWording: string }

export const TRIGGERS: TriggerDef[] = [
  { id: 'quiet', label: 'A deal has had no activity', amountLabel: 'for at least', unit: 'days', min: 2, max: 60, default: 5, agentWording: 'These deals have had no activity for a while.' },
  { id: 'closing', label: 'A closing is coming up', amountLabel: 'within', unit: 'days', min: 1, max: 60, default: 7, agentWording: 'These deals close soon.' },
  { id: 'late_steps', label: 'A deal has overdue steps', amountLabel: 'more than', unit: 'steps overdue', min: 0, max: 30, default: 2, agentWording: 'These deals have steps past their due date.' },
  { id: 'missing_docs', label: 'A file is missing a required document', amountLabel: null, min: 0, max: 0, default: 0, agentWording: 'These files are missing documents your brokerage requires.' },
  { id: 'new_deal', label: 'A new deal was opened', amountLabel: 'in the last', unit: 'days', min: 1, max: 14, default: 1, agentWording: 'These deals were just opened.' },
  { id: 'closed', label: 'A deal closed', amountLabel: 'in the last', unit: 'days', min: 1, max: 30, default: 1, agentWording: 'These deals closed.' },
];
export const triggerOf = (id: WorkflowTrigger) => TRIGGERS.find((t) => t.id === id) as TriggerDef;

export interface WorkflowInput { name: string; trigger: WorkflowTrigger; amount: number; notifyAgent: boolean; notifyOwner: OwnerMode; escalateDays: number; agentIds: string[]; dealTypes: string[]; enabled: boolean }

/** A workflow from a request, cleaned: a name, a known trigger, numbers in range. Returns an error message when it can not be used. */
export function cleanWorkflow(input: unknown, validAgents: Set<string>): { ok: true; value: WorkflowInput } | { ok: false; error: string } {
  const b = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, WORKFLOW_NAME_MAX) : '';
  if (!name) return { ok: false, error: 'Give the workflow a name.' };
  if (!(WORKFLOW_TRIGGERS as readonly string[]).includes(String(b.trigger))) return { ok: false, error: 'Choose what starts it.' };
  const t = triggerOf(b.trigger as WorkflowTrigger);
  const n = Number(b.amount);
  const amount = t.amountLabel ? Math.min(t.max, Math.max(t.min, Number.isFinite(n) ? Math.round(n) : t.default)) : 0;
  const notifyOwner: OwnerMode = (OWNER_MODES as readonly string[]).includes(String(b.notifyOwner)) ? (b.notifyOwner as OwnerMode) : 'escalate';
  const notifyAgent = b.notifyAgent !== false;
  if (!notifyAgent && notifyOwner === 'never') return { ok: false, error: 'Choose someone to tell: the agent, you, or both.' };
  const e = Number(b.escalateDays);
  const strings = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120))].slice(0, max) : []);
  return {
    ok: true,
    value: {
      name, trigger: t.id, amount, notifyAgent, notifyOwner,
      escalateDays: Math.min(30, Math.max(1, Number.isFinite(e) ? Math.round(e) : 2)),
      agentIds: strings(b.agentIds, 200).filter((id) => validAgents.has(id)),
      dealTypes: strings(b.dealTypes, 30),
      enabled: b.enabled !== false,
    },
  };
}

/** One sentence describing a workflow, for lists: "No activity for at least 5 days · tell the agent, then you after 2 days". */
export function describeWorkflow(w: Pick<WorkflowInput, 'trigger' | 'amount' | 'notifyAgent' | 'notifyOwner' | 'escalateDays'>): string {
  const t = triggerOf(w.trigger);
  const when = `${t.label}${t.amountLabel ? ` ${t.amountLabel} ${w.amount} ${t.unit}` : ''}`;
  const who = [w.notifyAgent ? 'the agent' : null, w.notifyOwner === 'now' ? 'you now' : w.notifyOwner === 'escalate' ? (w.notifyAgent ? `you after ${w.escalateDays} more day${w.escalateDays === 1 ? '' : 's'} if unresolved` : 'you') : null].filter(Boolean).join(', then ');
  return `${when} → tell ${who}`;
}

/** The flags for a custom workflow's trigger, for the deals already limited to its agents and deal types. */
export function workflowFlags(trigger: WorkflowTrigger, amount: number, deals: DealLite[], today: string, missingByDeal: Map<string, string[]>, closedDay: (d: DealLite) => string): Flag[] {
  const place_ = (d: DealLite) => d.property_address || 'A deal';
  if (trigger === 'quiet') return stalledFlags(deals, today, amount);
  if (trigger === 'closing') return closingFlags(deals, today, amount);
  if (trigger === 'missing_docs') return documentFlags(deals, missingByDeal);
  if (trigger === 'late_steps') return deals.filter((d) => open(d) && d.health.overdueTasks > amount).map((d) => ({ key: `${d.id}:late:${d.health.overdueTasks}`, agentId: d.tc_user_id, dealId: d.id, address: place_(d), reason: `${d.health.overdueTasks} step${d.health.overdueTasks === 1 ? '' : 's'} overdue` }));
  const since = addDays(today, -amount);
  if (trigger === 'new_deal') return deals.filter((d) => d.acceptance_date && d.acceptance_date.slice(0, 10) >= since && d.acceptance_date.slice(0, 10) <= today).map((d) => ({ key: `${d.id}:new`, agentId: d.tc_user_id, dealId: d.id, address: place_(d), reason: 'Opened recently' }));
  return deals.filter((d) => !open(d) && closedDay(d) >= since && closedDay(d) <= today).map((d) => ({ key: `${d.id}:closed`, agentId: d.tc_user_id, dealId: d.id, address: place_(d), reason: `Closed ${closedDay(d)}` }));
}

export function workflowAgentText(name: string, trigger: WorkflowTrigger, flags: Flag[]): { subject: string; paragraphs: string[] } {
  return { subject: `${name}: ${plural(flags.length, 'file')}`, paragraphs: [triggerOf(trigger).agentWording, lines(flags)] };
}

/** Workflows a broker can add in one click from the library. */
export const WORKFLOW_PRESETS: (Omit<WorkflowInput, 'agentIds' | 'dealTypes' | 'enabled'> & { blurb: string })[] = [
  { name: 'Deal quiet for 10 days', blurb: 'A longer watch for deals that stop moving.', trigger: 'quiet', amount: 10, notifyAgent: true, notifyOwner: 'escalate', escalateDays: 3 },
  { name: 'Final check 3 days before closing', blurb: 'A last nudge to the agent and you as closing nears.', trigger: 'closing', amount: 3, notifyAgent: true, notifyOwner: 'now', escalateDays: 1 },
  { name: 'Deal falling behind', blurb: 'More than 2 overdue steps on one deal.', trigger: 'late_steps', amount: 2, notifyAgent: true, notifyOwner: 'escalate', escalateDays: 2 },
  { name: 'Tell me about every new deal', blurb: 'You hear when an agent opens a deal.', trigger: 'new_deal', amount: 1, notifyAgent: false, notifyOwner: 'now', escalateDays: 1 },
  { name: 'Tell me when a deal closes', blurb: 'A short note for each closing.', trigger: 'closed', amount: 1, notifyAgent: false, notifyOwner: 'now', escalateDays: 1 },
  { name: 'Required documents still missing', blurb: 'Agent first, then you if it drags on.', trigger: 'missing_docs', amount: 0, notifyAgent: true, notifyOwner: 'escalate', escalateDays: 3 },
];
