// The Automation Library (phase 1): reusable workflows a person builds once and applies to many deals or listings.
// Pure on purpose (no database, no imports from the server): the Automations page uses the catalog in the browser, and the
// scheduling rule below is unit-tested without Supabase. Everything a template can do is listed here; anything not listed
// cannot be saved, whatever the request says.

export type Category = 'transaction' | 'listing';

export interface TriggerDef {
  id: string;
  category: Category;
  label: string;
  /** created = the deal/listing was created; event = a real event row in transaction_events; date = a date on the record. */
  kind: 'created' | 'event' | 'date';
  help: string;
}

export const TRIGGERS: readonly TriggerDef[] = [
  { id: 'transaction_created', category: 'transaction', kind: 'created', label: 'Transaction created', help: 'When the transaction is created.' },
  { id: 'contract_uploaded', category: 'transaction', kind: 'event', label: 'Contract uploaded', help: 'When a Purchase Contract is added to the deal.' },
  { id: 'document_added', category: 'transaction', kind: 'event', label: 'Any document uploaded', help: 'Each time a document is added to the deal.' },
  { id: 'deal_closed', category: 'transaction', kind: 'event', label: 'Transaction closed', help: 'When the deal is marked Closed.' },
  { id: 'acceptance_date', category: 'transaction', kind: 'date', label: 'Contract acceptance date', help: "Counted from the deal's acceptance date." },
  { id: 'earnest_money_due', category: 'transaction', kind: 'date', label: 'Earnest money due date', help: "Counted from the deal's Critical dates. Stops once you mark that date done." },
  { id: 'inspection_deadline', category: 'transaction', kind: 'date', label: 'Inspection / option period deadline', help: "Counted from the deal's Critical dates. Stops once you mark that date done." },
  { id: 'appraisal_deadline', category: 'transaction', kind: 'date', label: 'Appraisal deadline', help: "Counted from the deal's Critical dates. Stops once you mark that date done." },
  { id: 'financing_deadline', category: 'transaction', kind: 'date', label: 'Financing contingency deadline', help: "Counted from the deal's Critical dates. Stops once you mark that date done." },
  { id: 'title_commitment_due', category: 'transaction', kind: 'date', label: 'Title commitment due date', help: "Counted from the deal's Critical dates. Stops once you mark that date done." },
  { id: 'closing_date', category: 'transaction', kind: 'date', label: 'Closing date', help: "Counted from the deal's closing date. It follows the date if it changes." },
  { id: 'listing_created', category: 'listing', kind: 'created', label: 'Listing created', help: 'When the listing is created.' },
  { id: 'listing_planned_list_date', category: 'listing', kind: 'date', label: 'Planned list date', help: "Counted from the listing's planned list date." },
  { id: 'listing_expiration', category: 'listing', kind: 'date', label: 'Listing expiration date', help: "Counted from the listing's expiration date." },
];

export type StepType = 'send_email' | 'create_task' | 'notify_me' | 'add_note';

export const STEP_TYPES: readonly { id: StepType; label: string; categories: Category[]; help: string }[] = [
  { id: 'send_email', label: 'Send an email', categories: ['transaction'], help: 'To people on the deal, by role. Drafts wait for your approval unless the deal is on Auto.' },
  { id: 'create_task', label: 'Add a checklist step', categories: ['transaction'], help: 'Adds a step to the transaction checklist.' },
  { id: 'notify_me', label: 'Notify me', categories: ['transaction', 'listing'], help: 'Puts a notification in your Relay bell.' },
  { id: 'add_note', label: 'Add a note', categories: ['transaction', 'listing'], help: 'Writes a note on the Activity list.' },
];

/** Who an email can go to. Matched against the people on the deal; anyone who is not on the deal can never be reached. */
export const RECIPIENT_ROLES = [
  { id: 'agent', label: 'Agent' },
  { id: 'buyer', label: 'Buyer' },
  { id: 'seller', label: 'Seller' },
  { id: 'lender', label: 'Lender' },
  { id: 'title', label: 'Title / escrow' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'appraiser', label: 'Appraiser' },
  { id: 'attorney', label: 'Attorney' },
  { id: 'everyone', label: 'Everyone on the deal' },
] as const;

export interface Step {
  id: string;
  type: StepType;
  when: { days: number; direction: 'after' | 'before' };
  to?: string[];
  subject?: string;
  message?: string;
  name?: string;
  dueInDays?: number | null;
  title?: string;
  body?: string;
  text?: string;
}

export interface Definition {
  name: string;
  description: string;
  category: Category;
  triggerType: string;
  steps: Step[];
}

export const MAX_STEPS = 12;
export const triggerOf = (id: string) => TRIGGERS.find((t) => t.id === id);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intIn = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

export type Validated = { ok: true; value: Definition } | { ok: false; error: string };

/** Turns whatever came over the wire into a safe definition, or says what is wrong in words a person can act on. */
export function validateDefinition(input: unknown): Validated {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const name = str(o.name, 120);
  if (!name) return { ok: false, error: 'Give the automation a name.' };
  const category = o.category === 'transaction' || o.category === 'listing' ? o.category : null;
  if (!category) return { ok: false, error: 'Choose Transaction or Listing.' };
  const trigger = triggerOf(str(o.triggerType, 60));
  if (!trigger || trigger.category !== category) return { ok: false, error: 'Choose a trigger that fits this type of automation.' };
  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  if (rawSteps.length === 0) return { ok: false, error: 'Add at least one step.' };
  if (rawSteps.length > MAX_STEPS) return { ok: false, error: `An automation can have at most ${MAX_STEPS} steps.` };

  const steps: Step[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawSteps.length; i++) {
    const r = (typeof rawSteps[i] === 'object' && rawSteps[i] !== null ? rawSteps[i] : {}) as Record<string, unknown>;
    const n = i + 1;
    const spec = STEP_TYPES.find((s) => s.id === r.type);
    if (!spec || !spec.categories.includes(category)) return { ok: false, error: `Step ${n}: that action is not available for ${category} automations.` };
    const w = (typeof r.when === 'object' && r.when !== null ? r.when : {}) as Record<string, unknown>;
    const days = intIn(w.days, 0, 365);
    if (days === null) return { ok: false, error: `Step ${n}: enter a number of days between 0 and 365.` };
    const direction = w.direction === 'before' ? 'before' : 'after';
    if (direction === 'before' && trigger.kind !== 'date') return { ok: false, error: `Step ${n}: "before" only works with a date trigger.` };
    let id = str(r.id, 40).replace(/[^a-zA-Z0-9_-]/g, '') || `s${n}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const step: Step = { id, type: spec.id, when: { days, direction } };
    if (spec.id === 'send_email') {
      const to = Array.isArray(r.to) ? [...new Set((r.to as unknown[]).filter((t): t is string => typeof t === 'string' && RECIPIENT_ROLES.some((x) => x.id === t)))] : [];
      if (to.length === 0) return { ok: false, error: `Step ${n}: choose who the email goes to.` };
      step.to = to;
      step.subject = str(r.subject, 200);
      step.message = str(r.message, 5000);
      if (!step.subject || !step.message) return { ok: false, error: `Step ${n}: the email needs a subject and a message.` };
    } else if (spec.id === 'create_task') {
      step.name = str(r.name, 255);
      if (!step.name) return { ok: false, error: `Step ${n}: name the checklist step.` };
      const due = r.dueInDays === null || r.dueInDays === undefined || r.dueInDays === '' ? null : intIn(r.dueInDays, 0, 365);
      if (r.dueInDays !== null && r.dueInDays !== undefined && r.dueInDays !== '' && due === null) return { ok: false, error: `Step ${n}: the due date must be 0 to 365 days.` };
      step.dueInDays = due;
    } else if (spec.id === 'notify_me') {
      step.title = str(r.title, 160);
      if (!step.title) return { ok: false, error: `Step ${n}: write the notification.` };
      step.body = str(r.body, 160);
    } else {
      step.text = str(r.text, 2000);
      if (!step.text) return { ok: false, error: `Step ${n}: write the note.` };
    }
    steps.push(step);
  }
  return { ok: true, value: { name, description: str(o.description, 500), category, triggerType: trigger.id, steps } };
}

/** "3 days after Contract uploaded", "2 days before Closing date". */
export function describeWhen(step: Step, triggerLabel: string): string {
  const { days, direction } = step.when;
  if (days === 0 && direction === 'after') return `Right away (${triggerLabel.toLowerCase()})`;
  return `${days} day${days === 1 ? '' : 's'} ${direction} ${triggerLabel.toLowerCase()}`;
}

// ---- Scheduling ---------------------------------------------------------------------------------------------------

export interface InstanceFacts {
  createdAt: string; // when this copy was applied to the deal
  timeZone: string;
  dealCreatedAt: string | null;
  closingDate: string | null;
  acceptanceDate: string | null;
  plannedListDate: string | null;
  expirationDate: string | null;
  /** Latest occurrence of each event type that happened after this copy was applied. */
  events: Record<string, string | undefined>;
  /** The deal's Critical dates by kind (earliest open one). A completed date is done: nothing more is sent for it. */
  keyDates?: Record<string, { date: string; completed: boolean } | undefined>;
}

/** Which Critical date kind (src/lib/keyDates.ts) each deadline trigger reads. */
export const KEY_DATE_KIND_OF: Record<string, string> = {
  earnest_money_due: 'earnest_money',
  inspection_deadline: 'inspection',
  appraisal_deadline: 'appraisal',
  financing_deadline: 'financing',
  title_commitment_due: 'title_commitment',
};

export type Anchor = { kind: 'time'; at: string } | { kind: 'day'; day: string };

export function triggerAnchor(triggerType: string, f: InstanceFacts): Anchor | null {
  const day = (d: string | null): Anchor | null => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? { kind: 'day', day: d.slice(0, 10) } : null);
  switch (triggerType) {
    case 'transaction_created':
    case 'listing_created':
      return f.dealCreatedAt ? { kind: 'time', at: f.dealCreatedAt } : null;
    case 'contract_uploaded':
    case 'document_added':
    case 'deal_closed':
      return f.events[triggerType] ? { kind: 'time', at: f.events[triggerType]! } : null;
    case 'closing_date':
      return day(f.closingDate);
    case 'earnest_money_due':
    case 'inspection_deadline':
    case 'appraisal_deadline':
    case 'financing_deadline':
    case 'title_commitment_due': {
      const kd = f.keyDates?.[KEY_DATE_KIND_OF[triggerType]];
      return kd && !kd.completed ? day(kd.date) : null;
    }
    case 'acceptance_date':
      return day(f.acceptanceDate);
    case 'listing_planned_list_date':
      return day(f.plannedListDate);
    case 'listing_expiration':
      return day(f.expirationDate);
    default:
      return null;
  }
}

export const localDayOf = (now: Date, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const GRACE_MS = 60 * 60 * 1000; // a step due just before the copy was applied (e.g. "right away" at creation) still counts
const MAX_LATE_DAYS = 3; // after an outage, anything this old is skipped instead of firing in a burst

/**
 * Which steps should fire now. A step fires once per anchor (the idempotency key carries the anchor, so a changed closing
 * date schedules its steps again). Steps whose time passed before the copy was applied, or more than a few days ago, are
 * skipped rather than fired late.
 */
export function dueSteps(instanceId: string, triggerType: string, steps: Step[], f: InstanceFacts, now: Date, fired: ReadonlySet<string>): { step: Step; key: string }[] {
  const anchor = triggerAnchor(triggerType, f);
  if (!anchor) return [];
  const out: { step: Step; key: string }[] = [];
  const created = Date.parse(f.createdAt);
  const today = localDayOf(now, f.timeZone);
  const createdDay = localDayOf(new Date(created), f.timeZone);
  for (const step of steps) {
    const sign = step.when.direction === 'before' ? -1 : 1;
    const key = `inst:${instanceId}:${step.id}:${anchor.kind === 'time' ? anchor.at : anchor.day}`;
    if (fired.has(key)) continue;
    if (anchor.kind === 'time') {
      const due = Date.parse(anchor.at) + sign * step.when.days * 86_400_000;
      if (now.getTime() < due || due < created - GRACE_MS || now.getTime() - due > MAX_LATE_DAYS * 86_400_000) continue;
    } else {
      const dueDay = addDays(anchor.day, sign * step.when.days);
      if (today < dueDay || dueDay < createdDay || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDay}T00:00:00Z`) > MAX_LATE_DAYS * 86_400_000) continue;
    }
    out.push({ step, key });
  }
  return out;
}

// ---- Filling in a step --------------------------------------------------------------------------------------------

export interface Person {
  name: string;
  email: string | null;
  role: string;
  category: string;
}

/** Emails for the chosen roles, only from people actually on the deal, each address once. */
export function resolveRecipients(tokens: string[], people: Person[]): string[] {
  const out = new Map<string, string>();
  for (const p of people) {
    const email = p.email?.trim();
    if (!email) continue;
    const cat = p.category.toLowerCase();
    const role = p.role.toLowerCase();
    const hit = tokens.some((t) => t === 'everyone' || cat === t || (t === 'title' && cat === 'title') || (t === 'agent' && role === 'agent'));
    if (hit) out.set(email.toLowerCase(), email);
  }
  return [...out.values()];
}

/**
 * Roles an automation emails that nobody on the deal can receive (no one with that role, or no email address for them).
 * Shown to the person so a step that would be skipped is never a surprise.
 */
export function missingRecipientRoles(steps: Step[], people: Person[]): string[] {
  const tokens = new Set<string>();
  for (const s of steps) if (s.type === 'send_email') for (const t of s.to ?? []) tokens.add(t);
  const missing: string[] = [];
  for (const t of tokens) {
    if (resolveRecipients([t], people).length === 0) missing.push(RECIPIENT_ROLES.find((r) => r.id === t)?.label ?? t);
  }
  return missing;
}

export function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => vars[k.toLowerCase()] ?? m);
}

/** Placeholders a person can type in a subject or message. */
export const VARIABLES = [
  { id: 'address', label: 'Property address' },
  { id: 'file_number', label: 'File number' },
  { id: 'closing_date', label: 'Closing date' },
  { id: 'client_name', label: 'Buyer or seller name' },
] as const;
