import { loadListingParties } from './listingContext';
import { userMayAutomate } from './plan';
import { isFeatureOn } from '../features';
import { supabaseServer } from '../supabase';
import { getEntitlements } from '../entitlements';
import { agentHas } from '../tiers';
import { assertTrialActive, TrialExpiredError } from '../trial';
import { loadDealForTemplates, recipientsOf, displayNameOf } from '../templateContext';
import { outboxOnly, plainToHtml, sendDealEmail } from '../dealEmail';
import { getResendClient, INVOICE_FROM_EMAIL } from '../resendClient';
import { getMutedTypes } from '../notifications';
import { completeTask, setDealDate } from '../dealActions';
import { isValidCategory, isValidDocumentType } from '../documentTaxonomy';
import { dealAutomationOwner } from './events';
import { approveAction, resumeAction, submitAction, TEMPLATE_FLAG, type ActionDeps, type ActionOutcome, type ActionRequest, type ActionRow, type ActionStore, type Executor } from './actionCore';
import type { GuardContext } from './guard';
import type { AutomationMode } from './types';

// Server wiring for the action pipeline. Rules live in actionCore.ts (pure, tested) and guard.ts.
// BUILT executors: create_task, send_deal_email. Every other catalog action is recorded by the guard but fails with
// `not_implemented` until its shared action function is extracted from the manual route (PLANNED).

const COLUMNS = 'id, owner_user_id, transaction_id, listing_id, kind, status, inputs, result, refusal_reason, attempts, approved_by';

export const supabaseActionStore: ActionStore = {
  async record(req) {
    const insert = {
      owner_user_id: req.ownerUserId,
      transaction_id: req.transactionId ?? null,
      listing_id: req.listingId ?? null,
      event_id: req.eventId ?? null,
      instance_id: req.instanceId ?? null,
      step_id: req.stepId ?? null,
      kind: req.kind,
      // The "routine template reminder" flag travels with the action so a later retry or resume still knows it.
      inputs: req.fromApprovedTemplate ? { ...req.inputs, [TEMPLATE_FLAG]: true } : req.inputs,
      idempotency_key: req.idempotencyKey,
    };
    const { data, error } = await supabaseServer.from('automation_actions').insert(insert).select(COLUMNS).single();
    if (!error && data) return { row: data as ActionRow, created: true };
    if (error?.code === '23505') {
      const { data: existing, error: e2 } = await supabaseServer.from('automation_actions').select(COLUMNS).eq('idempotency_key', req.idempotencyKey).single();
      if (e2 || !existing) throw e2 ?? new Error('Action not found after duplicate key');
      return { row: existing as ActionRow, created: false };
    }
    throw error;
  },
  async get(id) {
    const { data } = await supabaseServer.from('automation_actions').select(COLUMNS).eq('id', id).maybeSingle();
    return (data as ActionRow | null) ?? null;
  },
  async claimDue(now, limit, leaseMinutes) {
    const nowIso = now.toISOString();
    const { data: due, error } = await supabaseServer.from('automation_actions').select('id').eq('status', 'deferred').lte('next_attempt_at', nowIso).order('next_attempt_at', { ascending: true }).limit(limit);
    if (error) throw error;
    const claimed: ActionRow[] = [];
    for (const { id } of due ?? []) {
      // Conditional update: only one overlapping run can move next_attempt_at past now for the same row.
      const lease = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
      const { data } = await supabaseServer.from('automation_actions').update({ next_attempt_at: lease }).eq('id', id).eq('status', 'deferred').lte('next_attempt_at', nowIso).select(COLUMNS);
      if (data && data.length === 1) claimed.push(data[0] as unknown as ActionRow);
    }
    return claimed;
  },
  async update(id, patch) {
    const { error } = await supabaseServer.from('automation_actions').update(patch).eq('id', id);
    if (error) throw error;
  },
  async createApproval(actionId, ownerUserId, draft) {
    const { error } = await supabaseServer.from('automation_approvals').upsert({ action_id: actionId, owner_user_id: ownerUserId, draft }, { onConflict: 'action_id', ignoreDuplicates: true });
    if (error) throw error;
  },
  async decideApproval(actionId, status, decidedBy, draft) {
    const { error } = await supabaseServer
      .from('automation_approvals')
      .update({ status, decided_by: decidedBy, decided_at: new Date().toISOString(), ...(draft ? { draft, edited: true } : {}) })
      .eq('action_id', actionId);
    if (error) throw error;
  },
};

async function ownerIsEntitled(ownerUserId: string): Promise<boolean> {
  const { data } = await supabaseServer.auth.admin.getUserById(ownerUserId);
  const user = data.user;
  if (!user) return false;
  if (!userMayAutomate(user)) return false; // plan gate, checked now: a downgraded account stops at once
  const ent = getEntitlements(user);
  if (!ent.canOwnWorkspace) return false; // a free collaborator owns nothing, so automation does not run for them
  if (ent.agentLevel && !agentHas(ent.agentLevel, 'automation')) return false;
  if (ent.kind !== 'admin') {
    try {
      await assertTrialActive(user);
    } catch (err) {
      if (err instanceof TrialExpiredError) return false;
      throw err;
    }
  }
  return true;
}

/** Reads the facts the guard needs, NOW. Called at submit and again at approval. */
export async function loadGuardContext(req: ActionRequest): Promise<GuardContext> {
  const now = new Date();
  // Owner-level actions (the daily briefing) have no deal: they may run when the owner has switched the assistant on anywhere.
  const ownerLevel = !req.transactionId && !req.listingId;
  const [{ data: control }, { data: settings }, entitled] = await Promise.all([
    supabaseServer.from('automation_account_controls').select('paused').eq('owner_user_id', req.ownerUserId).maybeSingle(),
    (() => {
      const base = supabaseServer.from('automation_settings').select('mode, quiet_start_hour, quiet_end_hour, time_zone, daily_send_cap').eq('owner_user_id', req.ownerUserId);
      if (ownerLevel) return base.neq('mode', 'off').limit(1).maybeSingle();
      return (req.transactionId ? base.eq('transaction_id', req.transactionId) : base.eq('listing_id', req.listingId ?? '')).maybeSingle();
    })(),
    ownerIsEntitled(req.ownerUserId),
  ]);

  let allowedRecipients: string[] = [];
  let sentToday = 0;
  if (!req.transactionId && req.listingId) {
    const listing = await loadListingParties(req.listingId);
    const { data: own } = await supabaseServer.from('listings').select('tc_user_id').eq('id', req.listingId).maybeSingle();
    // The listing must belong to this owner; only its agent and saved contacts can ever be emailed.
    if (listing && own?.tc_user_id === req.ownerUserId) allowedRecipients = listing.people.map((p) => p.email!.toLowerCase());
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const { data: sent } = await supabaseServer.from('automation_actions').select('result').eq('listing_id', req.listingId).eq('status', 'executed').in('kind', ['send_deal_email', 'send_step_email']).gte('executed_at', since);
    sentToday = (sent ?? []).reduce((n, r) => n + (Array.isArray((r.result as { to?: unknown } | null)?.to) ? ((r.result as { to: unknown[] }).to.length) : 1), 0);
  }
  if (req.transactionId) {
    const deal = await loadDealForTemplates(req.transactionId);
    // The deal must belong to this owner; otherwise nothing is allowed to go anywhere.
    const dealOwner = await dealAutomationOwner(req.transactionId);
    if (deal && dealOwner === req.ownerUserId) allowedRecipients = recipientsOf(deal).map((p) => p.email!.toLowerCase());
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const { data: sent } = await supabaseServer
      .from('automation_actions')
      .select('result')
      .eq('transaction_id', req.transactionId)
      .eq('status', 'executed')
      .in('kind', ['send_deal_email', 'send_step_email'])
      .gte('executed_at', since);
    sentToday = (sent ?? []).reduce((n, r) => n + (Array.isArray((r.result as { to?: unknown } | null)?.to) ? ((r.result as { to: unknown[] }).to.length) : 1), 0);
  }

  return {
    featureOn: isFeatureOn('automation'),
    killSwitch: process.env.AUTOMATION_KILL_SWITCH === '1' || control?.paused === true,
    entitled,
    mode: ((settings?.mode as AutomationMode | undefined) ?? 'off'), // no settings row = Off
    allowedRecipients,
    sentToday,
    dailySendCap: (settings?.daily_send_cap as number | undefined) ?? 20,
    quietHours: settings ? { startHour: settings.quiet_start_hour as number, endHour: settings.quiet_end_hour as number, timeZone: settings.time_zone as string } : undefined,
    now,
  };
}

/** The deal must still belong to the owner the action was recorded for. Recheck at execution; never trust the saved row. */
async function assertOwnsDeal(action: ActionRow): Promise<string> {
  if (!action.transaction_id) throw new Error('This action needs a deal');
  if ((await dealAutomationOwner(action.transaction_id)) !== action.owner_user_id) throw new Error('Deal does not belong to this account');
  return action.transaction_id;
}

/** Deal or listing actions: whichever it is, it must belong to the account the action runs for. */
async function assertOwnsDealOrListing(action: ActionRow): Promise<void> {
  if (action.transaction_id) {
    await assertOwnsDeal(action);
    return;
  }
  if (!action.listing_id) throw new Error('This action needs a deal or a listing');
  const { data } = await supabaseServer.from('listings').select('tc_user_id').eq('id', action.listing_id).maybeSingle();
  if (!data || data.tc_user_id !== action.owner_user_id) throw new Error('Listing does not belong to this account');
}

const createTask: Executor = async (action) => {
  const name = typeof action.inputs.name === 'string' ? action.inputs.name.trim().slice(0, 255) : '';
  if (!name) throw new Error('A task needs a name');
  const dueDate = typeof action.inputs.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(action.inputs.dueDate) ? action.inputs.dueDate : null;
  if (!action.transaction_id && action.listing_id) {
    // A listing's checklist: same rules, its own table.
    await assertOwnsDealOrListing(action);
    const { data: lastL } = await supabaseServer.from('listing_tasks').select('sort_order').eq('listing_id', action.listing_id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const { data: row, error: e } = await supabaseServer.from('listing_tasks').insert({ listing_id: action.listing_id, name: name.slice(0, 200), due_date: dueDate, sort_order: ((lastL?.sort_order as number | undefined) ?? 0) + 1 }).select('id').single();
    if (e) throw e;
    return { taskId: row.id };
  }
  const transactionId = await assertOwnsDeal(action);
  const { data: last } = await supabaseServer.from('tasks').select('sort_order').eq('transaction_id', transactionId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabaseServer.from('tasks').insert({ transaction_id: transactionId, name, due_date: dueDate, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1 }).select('id').single();
  if (error) throw error;
  return { taskId: data.id };
};

const sendEmail: Executor = async (action) => {
  let transactionId: string | null = null;
  if (action.transaction_id) transactionId = await assertOwnsDeal(action);
  else await assertOwnsDealOrListing(action); // a listing email: still the owner's own listing
  const to = Array.isArray(action.inputs.to) ? (action.inputs.to as unknown[]).filter((a): a is string => typeof a === 'string') : [];
  const subject = typeof action.inputs.subject === 'string' ? action.inputs.subject.trim().slice(0, 200) : '';
  const message = typeof action.inputs.message === 'string' ? action.inputs.message.trim().slice(0, 10000) : '';
  if (!subject || !message) throw new Error('An email needs a subject and a message');
  const { data } = await supabaseServer.auth.admin.getUserById(action.owner_user_id);
  if (!data.user) throw new Error('Account not found');
  // D4: from Relay under the user's display name, Reply-To the deal's inbound address; outbox-only on a dev machine.
  const sent = await sendDealEmail({
    ownerUserId: action.owner_user_id,
    ownerName: displayNameOf(data.user),
    ownerEmail: data.user.email ?? null,
    transactionId,
    to,
    subject,
    message,
    source: 'automation',
    copySender: true,
    copyHidden: true,
  });
  return { to: to.map((a) => a.toLowerCase()), mode: sent.mode, subject, ...(sent.copiedTo.length ? { copiedTo: sent.copiedTo } : {}) };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A note lives on the deal's Activity timeline (this action row). It changes nothing else. */
const addNote: Executor = async (action) => {
  await assertOwnsDealOrListing(action);
  const text = clip(action.inputs.text, 2000);
  if (!text) throw new Error('A note needs text');
  return { text };
};

const notifyUser: Executor = async (action) => {
  const title = clip(action.inputs.title, 160);
  if (!title) throw new Error('A notification needs a title');
  if ((await getMutedTypes(action.owner_user_id)).includes('assistant')) return { muted: true };
  const transactionId = action.transaction_id;
  if (transactionId || action.listing_id) await assertOwnsDealOrListing(action);
  const { error } = await supabaseServer.from('notifications').insert({
    recipient_user_id: action.owner_user_id,
    actor_user_id: null,
    transaction_id: transactionId,
    event_type: 'assistant',
    title,
    body: clip(action.inputs.body, 160) || null,
    link: transactionId ? `/dashboard/transactions/${transactionId}` : action.listing_id ? `/dashboard/listings/${action.listing_id}` : '/dashboard',
  });
  if (error) throw error;
  return { delivered: true };
};

const suggestTick: Executor = async (action) => {
  const transactionId = await assertOwnsDeal(action);
  const taskId = clip(action.inputs.taskId, 60);
  if (!UUID.test(taskId)) throw new Error('A step id is needed');
  if (!(await completeTask(transactionId, taskId, action.owner_user_id))) throw new Error('That step is not on this deal');
  return { taskId };
};

const fileDocument: Executor = async (action) => {
  const transactionId = await assertOwnsDeal(action);
  const documentId = clip(action.inputs.documentId, 60);
  const category = clip(action.inputs.category, 80);
  const documentType = clip(action.inputs.documentType, 120);
  if (!UUID.test(documentId) || !isValidCategory(category) || !isValidDocumentType(category, documentType)) throw new Error('That document type is not valid');
  const { data, error } = await supabaseServer.from('documents').update({ category, document_type: documentType }).eq('id', documentId).eq('transaction_id', transactionId).select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw new Error('That document is not on this deal');
  return { documentId, category, documentType };
};

const setDate: Executor = async (action) => {
  const transactionId = await assertOwnsDeal(action);
  const field = action.inputs.field;
  const date = clip(action.inputs.date, 10);
  if ((field !== 'acceptance_date' && field !== 'closing_date') || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('A date field and a valid date are needed');
  await setDealDate(transactionId, field, date);
  return { field, date };
};

/** A step email is a deal email tied to one checklist step. The step must be on the deal. */
const sendStepEmail: Executor = async (action, ctx) => {
  const transactionId = await assertOwnsDeal(action);
  const taskId = clip(action.inputs.taskId, 60);
  if (taskId) {
    const { data } = await supabaseServer.from('tasks').select('id').eq('id', taskId).eq('transaction_id', transactionId).maybeSingle();
    if (!data) throw new Error('That step is not on this deal');
  }
  return sendEmail(action, ctx);
};

/** The daily briefing goes to the account owner only (never a deal contact). Outbox-only on a developer machine. */
const sendBriefing: Executor = async (action) => {
  const subject = clip(action.inputs.subject, 200);
  const message = clip(action.inputs.message, 10000);
  if (!subject || !message) throw new Error('A briefing needs a subject and a message');
  const { data } = await supabaseServer.auth.admin.getUserById(action.owner_user_id);
  const email = data.user?.email;
  if (!email) throw new Error('Account has no email');
  if (outboxOnly()) {
    const { error } = await supabaseServer.from('email_outbox').insert({ owner_user_id: action.owner_user_id, transaction_id: null, source: 'automation_briefing', to_emails: [email], from_name: 'Relay TC', subject, body: message });
    if (error) throw error;
    return { to: [email.toLowerCase()], mode: 'outbox', subject };
  }
  const signature = 'Sent by Relay TC. You can pause the assistant any time from a deal.';
  const { error } = await getResendClient().emails.send({ from: INVOICE_FROM_EMAIL, to: [email], subject, html: plainToHtml(message, signature), text: `${message}\n\n-- ${signature}` });
  if (error) {
    console.error('Resend rejected the briefing:', error);
    throw new Error('The briefing could not be sent');
  }
  return { to: [email.toLowerCase()], mode: 'sent', subject };
};

export const actionDeps: ActionDeps = {
  store: supabaseActionStore,
  loadGuardContext,
  executors: {
    create_task: createTask,
    add_note: addNote,
    notify_user: notifyUser,
    suggest_tick: suggestTick,
    classify_document: fileDocument,
    file_document: fileDocument,
    set_date: setDate,
    send_deal_email: sendEmail,
    send_step_email: sendStepEmail,
    send_briefing: sendBriefing,
  },
};

/** Propose an action (rule, AI or button). Subject to the flag, the guard and, where needed, approval. */
export function submitAutomationAction(req: ActionRequest): Promise<ActionOutcome> {
  return submitAction(req, actionDeps);
}

export function decideAutomationAction(actionId: string, decidedBy: string, opts: { reject?: boolean; editedInputs?: Record<string, unknown> } = {}) {
  return approveAction(actionId, decidedBy, actionDeps, opts);
}

/** Runner entry: re-checks and runs (or re-queues) a claimed deferred action. */
export function resumeAutomationAction(actionId: string) {
  return resumeAction(actionId, actionDeps);
}
