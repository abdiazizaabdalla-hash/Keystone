import { isFeatureOn } from '../features';
import { supabaseServer } from '../supabase';
import { getEntitlements } from '../entitlements';
import { agentHas } from '../tiers';
import { assertTrialActive, TrialExpiredError } from '../trial';
import { loadDealForTemplates, recipientsOf, displayNameOf } from '../templateContext';
import { sendDealEmail } from '../dealEmail';
import { dealAutomationOwner } from './events';
import { approveAction, submitAction, type ActionDeps, type ActionOutcome, type ActionRequest, type ActionRow, type ActionStore, type Executor } from './actionCore';
import type { GuardContext } from './guard';
import type { AutomationMode } from './types';

// Server wiring for the action pipeline. Rules live in actionCore.ts (pure, tested) and guard.ts.
// BUILT executors: create_task, send_deal_email. Every other catalog action is recorded by the guard but fails with
// `not_implemented` until its shared action function is extracted from the manual route (PLANNED).

const COLUMNS = 'id, owner_user_id, transaction_id, listing_id, kind, status, inputs, result, refusal_reason, attempts';

export const supabaseActionStore: ActionStore = {
  async record(req) {
    const insert = {
      owner_user_id: req.ownerUserId,
      transaction_id: req.transactionId ?? null,
      listing_id: req.listingId ?? null,
      event_id: req.eventId ?? null,
      kind: req.kind,
      inputs: req.inputs,
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
  const [{ data: control }, { data: settings }, entitled] = await Promise.all([
    supabaseServer.from('automation_account_controls').select('paused').eq('owner_user_id', req.ownerUserId).maybeSingle(),
    (req.transactionId
      ? supabaseServer.from('automation_settings').select('mode, quiet_start_hour, quiet_end_hour, time_zone, daily_send_cap').eq('transaction_id', req.transactionId)
      : supabaseServer.from('automation_settings').select('mode, quiet_start_hour, quiet_end_hour, time_zone, daily_send_cap').eq('listing_id', req.listingId ?? '')
    ).eq('owner_user_id', req.ownerUserId).maybeSingle(),
    ownerIsEntitled(req.ownerUserId),
  ]);

  let allowedRecipients: string[] = [];
  let sentToday = 0;
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

const createTask: Executor = async (action) => {
  const transactionId = await assertOwnsDeal(action);
  const name = typeof action.inputs.name === 'string' ? action.inputs.name.trim().slice(0, 255) : '';
  if (!name) throw new Error('A task needs a name');
  const dueDate = typeof action.inputs.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(action.inputs.dueDate) ? action.inputs.dueDate : null;
  const { data: last } = await supabaseServer.from('tasks').select('sort_order').eq('transaction_id', transactionId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabaseServer.from('tasks').insert({ transaction_id: transactionId, name, due_date: dueDate, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1 }).select('id').single();
  if (error) throw error;
  return { taskId: data.id };
};

const sendEmail: Executor = async (action) => {
  const transactionId = await assertOwnsDeal(action);
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
  });
  return { to: to.map((a) => a.toLowerCase()), mode: sent.mode, subject };
};

export const actionDeps: ActionDeps = {
  store: supabaseActionStore,
  loadGuardContext,
  executors: { create_task: createTask, send_deal_email: sendEmail },
};

/** Propose an action (rule, AI or button). Subject to the flag, the guard and, where needed, approval. */
export function submitAutomationAction(req: ActionRequest): Promise<ActionOutcome> {
  return submitAction(req, actionDeps);
}

export function decideAutomationAction(actionId: string, decidedBy: string, opts: { reject?: boolean; editedInputs?: Record<string, unknown> } = {}) {
  return approveAction(actionId, decidedBy, actionDeps, opts);
}
