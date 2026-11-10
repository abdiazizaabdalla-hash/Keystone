// Stage A: rules only, no AI (plan 16.5). Pure functions: a snapshot of a deal and "today" in, proposed actions out. The runner
// submits each proposal through the guard, so a rule can never send or write anything by itself. Every proposal carries an
// idempotency key built from the facts that make it unique, so evaluating the same deal every hour proposes each thing once.

export interface SnapshotTask {
  id: string;
  name: string;
  completed: boolean;
  dueDate: string | null; // YYYY-MM-DD
  waitingOn: string | null;
  waitingSince: string | null; // YYYY-MM-DD
}
export interface SnapshotPerson {
  name: string;
  email: string | null;
  role: string;
  category: string;
}
export interface DealSnapshot {
  id: string;
  address: string;
  fileNumber: string;
  status: string;
  acceptanceDate: string | null;
  closingDate: string | null;
  tasks: SnapshotTask[];
  documentTypes: string[];
  people: SnapshotPerson[];
  followUpDays: number;
}

export interface RuleProposal {
  kind: 'send_step_email' | 'notify_user';
  inputs: Record<string, unknown>;
  idempotencyKey: string;
  /** A routine reminder written from a fixed template: the only email Auto mode may send without approval. */
  fromApprovedTemplate?: boolean;
}

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);

/** Today's date (YYYY-MM-DD) in a time zone. Falls back to UTC for an unknown zone. */
export function localDay(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const MAX_CHASES = 5; // a step is chased at most this many times; after that a person has to decide
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** People on the deal with an email whose role matches what a step says it is waiting on ("Title company", "Lender"...). */
export function peopleWaitedOn(waitingOn: string, people: SnapshotPerson[]): SnapshotPerson[] {
  const w = waitingOn.trim().toLowerCase();
  if (!w) return [];
  const seen = new Set<string>();
  return people.filter((p) => {
    const email = p.email?.trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    const role = p.role.trim().toLowerCase();
    const category = p.category.trim().toLowerCase();
    const hit = (role && (role.includes(w) || w.includes(role))) || (category && (category === w || w.includes(category) || category.includes(w)));
    if (hit) seen.add(email);
    return Boolean(hit);
  });
}

function followUps(d: DealSnapshot, today: string): RuleProposal[] {
  const out: RuleProposal[] = [];
  for (const t of d.tasks) {
    if (t.completed || !t.waitingOn || !t.waitingSince) continue;
    const waited = daysBetween(t.waitingSince, today);
    const interval = Math.floor(waited / d.followUpDays);
    if (interval < 1 || interval > MAX_CHASES) continue;
    const who = peopleWaitedOn(t.waitingOn, d.people);
    if (who.length > 0) {
      out.push({
        kind: 'send_step_email',
        fromApprovedTemplate: true,
        idempotencyKey: `followup:${t.id}:${t.waitingSince}:${interval}`,
        inputs: {
          taskId: t.id,
          to: who.map((p) => p.email!.toLowerCase()),
          subject: clip(`Following up: ${t.name} (${d.address})`, 150),
          message: `Hello,\n\nI'm following up on "${t.name}" for ${d.address}. We've been waiting ${waited} day${waited === 1 ? '' : 's'} and want to keep the file on schedule.\n\nCould you send an update when you can?\n\nThank you.`,
        },
      });
    } else {
      out.push({
        kind: 'notify_user',
        idempotencyKey: `followup-notify:${t.id}:${t.waitingSince}:${interval}`,
        inputs: { title: clip(`Still waiting on ${t.waitingOn} (${waited} days)`, 120), body: `${t.name}. No one on this deal matches "${t.waitingOn}", so nothing was sent.` },
      });
    }
  }
  return out;
}

function deadlineGuard(d: DealSnapshot, today: string): RuleProposal[] {
  const out: RuleProposal[] = [];
  const open = d.tasks.filter((t) => !t.completed && t.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, 10);
  for (const t of open) {
    const left = daysBetween(today, t.dueDate!);
    if (left < 0) {
      out.push({ kind: 'notify_user', idempotencyKey: `deadline:${t.id}:${t.dueDate}:overdue`, inputs: { title: clip(`Overdue: ${t.name}`, 120), body: `Was due ${t.dueDate}.` } });
    } else if (left <= 2) {
      out.push({ kind: 'notify_user', idempotencyKey: `deadline:${t.id}:${t.dueDate}:soon`, inputs: { title: clip(`Due ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : 'in 2 days'}: ${t.name}`, 120), body: `Due ${t.dueDate}.` } });
    }
  }
  if (d.closingDate) {
    const left = daysBetween(today, d.closingDate);
    const openCount = d.tasks.filter((t) => !t.completed).length;
    if (left >= 0 && left <= 7 && openCount > 0) {
      out.push({ kind: 'notify_user', idempotencyKey: `closing-soon:${d.id}:${d.closingDate}`, inputs: { title: `Closing ${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`} with ${openCount} step${openCount === 1 ? '' : 's'} open`, body: d.closingDate } });
    }
  }
  return out;
}

function missingDocuments(d: DealSnapshot, today: string): RuleProposal[] {
  if (d.documentTypes.includes('Purchase Contract')) return [];
  const closingSoon = d.closingDate ? (() => { const left = daysBetween(today, d.closingDate!); return left >= 0 && left <= 14; })() : false;
  const underContractAWhile = d.acceptanceDate ? daysBetween(d.acceptanceDate, today) >= 3 : false;
  if (!closingSoon && !underContractAWhile) return [];
  return [{ kind: 'notify_user', idempotencyKey: `missing-contract:${d.id}`, inputs: { title: 'No purchase contract on this deal', body: 'Upload the signed purchase contract so the file is complete.' } }];
}

/** Everything the rules propose for one open deal today. Closed or cancelled deals propose nothing. */
export function evaluateDealRules(d: DealSnapshot, today: string): RuleProposal[] {
  if (/^(closed|cancel)/i.test(d.status)) return [];
  return [...followUps(d, today), ...deadlineGuard(d, today), ...missingDocuments(d, today)];
}

export interface BriefingDeal {
  address: string;
  overdue: string[];
  dueToday: string[];
  closingInDays: number | null;
  openWaiting: string[];
}

/** The plain-text daily briefing, or null when there is nothing worth sending. */
export function buildBriefing(date: string, deals: BriefingDeal[], pendingDrafts: number): { subject: string; message: string } | null {
  const lines: string[] = [];
  for (const d of deals) {
    const parts: string[] = [];
    if (d.overdue.length) parts.push(`Overdue: ${d.overdue.join('; ')}`);
    if (d.dueToday.length) parts.push(`Due today: ${d.dueToday.join('; ')}`);
    if (d.closingInDays !== null && d.closingInDays >= 0 && d.closingInDays <= 7) parts.push(`Closing in ${d.closingInDays} day${d.closingInDays === 1 ? '' : 's'}`);
    if (d.openWaiting.length) parts.push(`Waiting on: ${d.openWaiting.join('; ')}`);
    if (parts.length) lines.push(`${d.address}\n  ${parts.join('\n  ')}`);
  }
  if (lines.length === 0 && pendingDrafts === 0) return null;
  const head = pendingDrafts > 0 ? `${pendingDrafts} draft${pendingDrafts === 1 ? ' is' : 's are'} waiting for your approval.\n\n` : '';
  return {
    subject: `Your Relay briefing for ${date}`,
    message: `${head}${lines.length ? `What needs attention today:\n\n${lines.join('\n\n')}` : 'Nothing else needs attention today.'}`,
  };
}

// ---- Stalled deals ------------------------------------------------------------------------------------------------

export interface ActivitySnapshot {
  address: string;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  /** Latest recorded event on the deal (document added, step ticked, date changed...). */
  lastEventAt: string | null;
}

export const STALLED_AFTER_DAYS = 7;

/**
 * Open deals that have been quiet for a week: nothing recorded on them and no edits, and they are old enough that quiet means
 * something. This is a prompt to look, not a verdict; it changes nothing.
 */
export function findStalled(deals: ActivitySnapshot[], now: Date): string[] {
  const cutoff = now.getTime() - STALLED_AFTER_DAYS * 86_400_000;
  return deals
    .filter((d) => !/^(closed|cancel)/i.test(d.status))
    .filter((d) => Date.parse(d.createdAt) < cutoff)
    .filter((d) => Math.max(d.updatedAt ? Date.parse(d.updatedAt) : 0, d.lastEventAt ? Date.parse(d.lastEventAt) : 0) < cutoff)
    .map((d) => d.address);
}

/** Monday of the week containing `day` (YYYY-MM-DD), used to send the stalled-deals notice once a week. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
