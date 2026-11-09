import { isFeatureOn } from '../features';
import { supabaseServer } from '../supabase';
import { loadDealForTemplates } from '../templateContext';
import { resumeAutomationAction, submitAutomationAction } from './actions';
import { buildBriefing, daysBetween, evaluateDealRules, localDay, type BriefingDeal, type DealSnapshot } from './rules';
import { localHour } from './guard';
import { runInstances } from './instances';

// The runner (plan 16.4 item 6). Called hourly by a Supabase schedule and once a day by Vercel as a fallback; either call is
// safe to repeat because every proposal has an idempotency key and every claim is atomic. A tick does four things:
//   1. resumes work that was held (quiet hours) or is being retried after a failure;
//   2. reacts to new events by re-checking that deal now;
//   3. sweeps every deal with the assistant switched on (follow-up timers, deadline guard, missing documents);
//   4. sends each owner their daily briefing once their morning has started.

export interface TickReport {
  skipped?: string;
  resumed: number;
  events: number;
  dealsChecked: number;
  proposed: number;
  briefings: number;
  automations: number;
  outcomes: Record<string, number>;
  errors: string[];
}

const BATCH_RESUME = 25;
const BATCH_EVENTS = 50;
const BATCH_DEALS = 200;
const LEASE_MINUTES = 15;
const BRIEFING_HOUR = 7; // owner's local time

interface SettingsRow {
  owner_user_id: string;
  transaction_id: string;
  mode: 'draft' | 'auto';
  follow_up_days: number;
  time_zone: string;
}

async function loadSnapshot(transactionId: string, followUpDays: number): Promise<DealSnapshot | null> {
  const deal = await loadDealForTemplates(transactionId);
  if (!deal) return null;
  const [{ data: tasks }, { data: docs }] = await Promise.all([
    supabaseServer.from('tasks').select('id, name, completed, due_date, waiting_on, waiting_on_since').eq('transaction_id', transactionId).order('sort_order', { ascending: true }),
    supabaseServer.from('documents').select('document_type').eq('transaction_id', transactionId),
  ]);
  return {
    id: deal.id,
    address: deal.address,
    fileNumber: deal.fileNumber,
    status: deal.status,
    acceptanceDate: deal.acceptanceDate,
    closingDate: deal.closingDate,
    followUpDays,
    tasks: (tasks ?? []).map((t) => ({ id: t.id as string, name: t.name as string, completed: Boolean(t.completed), dueDate: (t.due_date as string | null) ?? null, waitingOn: (t.waiting_on as string | null) ?? null, waitingSince: (t.waiting_on_since as string | null) ?? null })),
    documentTypes: (docs ?? []).map((d) => d.document_type as string).filter(Boolean),
    people: [...(deal.agent ? [deal.agent] : []), ...deal.contacts].map((p) => ({ name: p.name, email: p.email, role: p.role, category: p.category })),
  };
}

export async function runTick(now: Date = new Date(), opts: { budgetMs?: number } = {}): Promise<TickReport> {
  const report: TickReport = { resumed: 0, events: 0, dealsChecked: 0, proposed: 0, briefings: 0, automations: 0, outcomes: {}, errors: [] };
  if (!isFeatureOn('automation')) return { ...report, skipped: 'automation is off' };
  const started = Date.now();
  const outOfTime = () => Date.now() - started > (opts.budgetMs ?? 45_000);
  const count = (status: string) => {
    report.outcomes[status] = (report.outcomes[status] ?? 0) + 1;
  };
  const fail = (what: string, err: unknown) => {
    console.error(`Automation tick: ${what}`, err);
    report.errors.push(`${what}: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 200));
  };

  // 1. Held and retrying work.
  try {
    const { supabaseActionStore } = await import('./actions');
    for (const row of await supabaseActionStore.claimDue(now, BATCH_RESUME, LEASE_MINUTES)) {
      if (outOfTime()) break;
      const out = await resumeAutomationAction(row.id);
      if ('status' in out) count(out.status);
      report.resumed++;
    }
  } catch (err) {
    fail('resume', err);
  }

  // Settings for every deal the assistant is switched on for.
  let settings: SettingsRow[] = [];
  try {
    const { data, error } = await supabaseServer.from('automation_settings').select('owner_user_id, transaction_id, mode, follow_up_days, time_zone').not('transaction_id', 'is', null).neq('mode', 'off').order('updated_at', { ascending: true }).limit(BATCH_DEALS);
    if (error) throw error;
    settings = (data ?? []) as SettingsRow[];
  } catch (err) {
    fail('settings', err);
  }
  const byDeal = new Map(settings.map((s) => [s.transaction_id, s]));
  const snapshots = new Map<string, DealSnapshot>();
  const checked = new Set<string>();

  const checkDeal = async (s: SettingsRow) => {
    if (checked.has(s.transaction_id)) return;
    checked.add(s.transaction_id);
    const snap = await loadSnapshot(s.transaction_id, s.follow_up_days);
    if (!snap) return;
    snapshots.set(s.transaction_id, snap);
    report.dealsChecked++;
    for (const p of evaluateDealRules(snap, localDay(now, s.time_zone))) {
      const out = await submitAutomationAction({ ownerUserId: s.owner_user_id, transactionId: s.transaction_id, kind: p.kind, inputs: p.inputs, fromApprovedTemplate: p.fromApprovedTemplate, idempotencyKey: p.idempotencyKey });
      if (!out.duplicate) {
        report.proposed++;
        count(out.status);
      }
    }
  };

  // 2. New events: re-check that deal straight away instead of waiting for the sweep.
  try {
    const { data: pending } = await supabaseServer.from('transaction_events').select('id, transaction_id').is('processed_at', null).order('occurred_at', { ascending: true }).limit(BATCH_EVENTS);
    for (const ev of pending ?? []) {
      if (outOfTime()) break;
      // Claim by marking it processed; if someone else already did, the update matches no row.
      const { data: claimed } = await supabaseServer.from('transaction_events').update({ processed_at: now.toISOString() }).eq('id', ev.id as string).is('processed_at', null).select('id');
      if (!claimed || claimed.length !== 1) continue;
      report.events++;
      const s = ev.transaction_id ? byDeal.get(ev.transaction_id as string) : undefined;
      if (s) {
        try {
          await checkDeal(s);
        } catch (err) {
          fail('event', err);
        }
      }
    }
  } catch (err) {
    fail('events', err);
  }

  // 3. Sweep.
  for (const s of settings) {
    if (outOfTime()) break;
    try {
      await checkDeal(s);
    } catch (err) {
      fail(`deal ${s.transaction_id}`, err);
    }
  }

  // 3b. Saved automations (the library): fire the steps that are due on every active copy.
  try {
    const r = await runInstances(now, outOfTime);
    report.automations = r.instances;
    report.proposed += r.proposed;
    for (const [k, v] of Object.entries(r.outcomes)) report.outcomes[k] = (report.outcomes[k] ?? 0) + v;
    report.errors.push(...r.errors);
  } catch (err) {
    fail('automations', err);
  }

  // 4. Daily briefings, once per owner per local day, from 7am local.
  const owners = new Map<string, SettingsRow[]>();
  for (const s of settings) owners.set(s.owner_user_id, [...(owners.get(s.owner_user_id) ?? []), s]);
  for (const [ownerId, rows] of owners) {
    if (outOfTime()) break;
    try {
      const tz = rows[0].time_zone;
      if (localHour(now, tz) < BRIEFING_HOUR) continue;
      const today = localDay(now, tz);
      const deals: BriefingDeal[] = [];
      for (const r of rows) {
        const snap = snapshots.get(r.transaction_id);
        if (!snap || /^(closed|cancel)/i.test(snap.status)) continue;
        deals.push({
          address: snap.address,
          overdue: snap.tasks.filter((t) => !t.completed && t.dueDate && daysBetween(today, t.dueDate) < 0).map((t) => t.name).slice(0, 5),
          dueToday: snap.tasks.filter((t) => !t.completed && t.dueDate === today).map((t) => t.name).slice(0, 5),
          closingInDays: snap.closingDate ? daysBetween(today, snap.closingDate) : null,
          openWaiting: snap.tasks.filter((t) => !t.completed && t.waitingOn).map((t) => t.waitingOn as string).slice(0, 5),
        });
      }
      const { count: pending } = await supabaseServer.from('automation_approvals').select('id', { count: 'exact', head: true }).eq('owner_user_id', ownerId).eq('status', 'pending');
      const briefing = buildBriefing(today, deals, pending ?? 0);
      if (!briefing) continue;
      const out = await submitAutomationAction({ ownerUserId: ownerId, kind: 'send_briefing', inputs: briefing, idempotencyKey: `briefing:${ownerId}:${today}` });
      if (!out.duplicate) {
        report.briefings++;
        count(out.status);
      }
    } catch (err) {
      fail(`briefing ${ownerId}`, err);
    }
  }
  return report;
}
