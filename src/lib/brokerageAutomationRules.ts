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

export function agentNoticeText(kind: 'stalled' | 'closing' | 'documents', flags: Flag[]): { subject: string; paragraphs: string[] } {
  const n = flags.length;
  if (kind === 'stalled') return { subject: `${plural(n, 'deal')} ${n === 1 ? 'has' : 'have'} gone quiet`, paragraphs: ['Your brokerage noticed these deals have had no activity for a while. Update the file or the checklist if something is moving.', lines(flags)] };
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
export function digestText(d: DigestInput): { subject: string; paragraphs: string[] } | null {
  const total = d.needsAttention.length + d.closing.length + d.lateAgents.length + d.quiet.length + d.newDeals.length;
  if (total === 0) return null;
  const out: string[] = [];
  if (d.needsAttention.length) out.push(`Needs attention (${d.needsAttention.length}):\n${d.needsAttention.slice(0, 10).map((x) => `${x.address} (${x.agentName}): ${x.reason}`).join('\n')}`);
  if (d.closing.length) out.push(`Closing in the next 7 days (${d.closing.length}):\n${d.closing.slice(0, 10).map((x) => `${x.address} (${x.agentName}): ${x.date}`).join('\n')}`);
  if (d.lateAgents.length) out.push(`Overdue steps:\n${d.lateAgents.map((x) => `${x.name}: ${plural(x.late, 'step')} overdue`).join('\n')}`);
  if (d.newDeals.length) out.push(`Opened yesterday (${d.newDeals.length}):\n${d.newDeals.slice(0, 10).map((x) => `${x.address} (${x.agentName})`).join('\n')}`);
  if (d.quiet.length) out.push(`No deals for a while: ${d.quiet.join(', ')}`);
  const attention = d.needsAttention.length + d.lateAgents.length;
  return { subject: attention > 0 ? `Your brokerage today: ${plural(attention, 'thing')} need${attention === 1 ? 's' : ''} you` : 'Your brokerage today', paragraphs: out };
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
