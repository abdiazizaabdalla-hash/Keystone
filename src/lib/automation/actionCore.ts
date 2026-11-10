import { evaluateGuard, type GuardContext, type GuardDecision } from './guard';
import type { ActionStatus } from './types';

// The action pipeline's pure core (plan 16.4 items 3, 4, 8). Every action, whether proposed by a rule, by the AI or by a
// person's button, goes through `submitAction`; every approval goes through `approveAction`. Both re-read the facts at
// execution time and ask the guard again, so a saved configuration is never proof that something is allowed.
// All storage and side effects are injected, which is what makes replay, retries and refusals testable.

export interface ActionRequest {
  ownerUserId: string;
  transactionId?: string | null;
  listingId?: string | null;
  eventId?: string | null;
  /** Set when the action comes from a saved automation copy running on this deal or listing. */
  instanceId?: string | null;
  stepId?: string | null;
  kind: string;
  inputs: Record<string, unknown>;
  fromApprovedTemplate?: boolean;
  /** Unique per intended effect, e.g. `follow_up:<taskId>:<dueDate>`. A second submit with the same key does nothing. */
  idempotencyKey: string;
}

/** The addresses an action will reach are read from the same `inputs.to` the executor sends to, so the guard checks exactly what is sent. */
export function recipientsOfInputs(inputs: Record<string, unknown>): string[] {
  return Array.isArray(inputs.to) ? (inputs.to as unknown[]).filter((a): a is string => typeof a === 'string') : [];
}

export interface ActionRow {
  id: string;
  owner_user_id: string;
  transaction_id: string | null;
  listing_id: string | null;
  kind: string;
  status: ActionStatus;
  inputs: Record<string, unknown>;
  result: Record<string, unknown> | null;
  refusal_reason: string | null;
  attempts: number;
  approved_by?: string | null;
}

export interface ActionStore {
  /** Inserts, or returns the existing row for the same idempotency key (created = false). */
  record(req: ActionRequest): Promise<{ row: ActionRow; created: boolean }>;
  get(id: string): Promise<ActionRow | null>;
  /**
   * Atomically claims up to `limit` deferred actions that are due. Claiming pushes next_attempt_at forward by `leaseMinutes`, so two
   * overlapping runs can never take the same row, and a run that dies simply lets it come due again later.
   */
  claimDue(now: Date, limit: number, leaseMinutes: number): Promise<ActionRow[]>;
  update(id: string, patch: Partial<Pick<ActionRow, 'status' | 'result' | 'refusal_reason' | 'attempts' | 'inputs'>> & { approved_by?: string; approved_at?: string; executed_at?: string; next_attempt_at?: string | null }): Promise<void>;
  createApproval(actionId: string, ownerUserId: string, draft: Record<string, unknown>): Promise<void>;
  decideApproval(actionId: string, status: 'approved' | 'rejected', decidedBy: string, draft?: Record<string, unknown>): Promise<void>;
}

export type Executor = (action: ActionRow, ctx: { now: Date }) => Promise<Record<string, unknown>>;

export interface ActionDeps {
  store: ActionStore;
  /** Reads CURRENT facts: mode, entitlement, kill switch, who is on the deal, today's send count. */
  loadGuardContext(req: ActionRequest): Promise<GuardContext>;
  executors: Partial<Record<string, Executor>>;
  now?: () => Date;
  /** How long a quiet-hours deferral waits before the runner may try again. */
  deferMinutes?: number;
}

export interface ActionOutcome {
  status: ActionStatus;
  actionId: string;
  duplicate: boolean;
  decision?: GuardDecision;
}

export const MAX_ATTEMPTS = 3;
/** Wait after the Nth failed attempt: 5 minutes, then 20. */
export const retryDelayMinutes = (attemptsSoFar: number) => 5 * 4 ** Math.max(0, attemptsSoFar - 1);

async function execute(row: ActionRow, deps: ActionDeps): Promise<ActionStatus> {
  const executor = deps.executors[row.kind];
  const now = (deps.now ?? (() => new Date()))();
  const attempts = row.attempts + 1;
  if (!executor) {
    await deps.store.update(row.id, { status: 'failed', refusal_reason: 'not_implemented', attempts });
    return 'failed';
  }
  try {
    const result = await executor(row, { now });
    await deps.store.update(row.id, { status: 'executed', result, executed_at: now.toISOString(), attempts });
    return 'executed';
  } catch (err) {
    console.error('Automation action failed:', row.kind, err);
    const error = err instanceof Error ? err.message.slice(0, 300) : 'failed';
    if (attempts < MAX_ATTEMPTS) {
      // Retry with backoff. The runner picks it up when next_attempt_at passes.
      const next = new Date(now.getTime() + retryDelayMinutes(attempts) * 60_000).toISOString();
      await deps.store.update(row.id, { status: 'deferred', refusal_reason: 'retrying', result: { error }, attempts, next_attempt_at: next });
      return 'deferred';
    }
    await deps.store.update(row.id, { status: 'failed', result: { error }, attempts });
    return 'failed';
  }
}

/** Propose an action. Runs it now if the guard allows it without approval; otherwise queues it, defers it or refuses it. */
export async function submitAction(req: ActionRequest, deps: ActionDeps): Promise<ActionOutcome> {
  const { row, created } = await deps.store.record(req);
  // Replay-safe: the same key a second time changes nothing and sends nothing.
  if (!created) return { status: row.status, actionId: row.id, duplicate: true };

  const ctx = await deps.loadGuardContext(req);
  const decision = evaluateGuard({ kind: req.kind, recipients: recipientsOfInputs(req.inputs), fromApprovedTemplate: req.fromApprovedTemplate }, ctx);

  if (decision.outcome === 'refuse') {
    await deps.store.update(row.id, { status: 'refused', refusal_reason: decision.detail ? `${decision.reason}:${decision.detail}` : decision.reason });
    return { status: 'refused', actionId: row.id, duplicate: false, decision };
  }
  if (decision.outcome === 'defer') {
    const next = new Date((deps.now ?? (() => new Date()))().getTime() + (deps.deferMinutes ?? 60) * 60_000).toISOString();
    await deps.store.update(row.id, { status: 'deferred', refusal_reason: decision.reason, next_attempt_at: next });
    return { status: 'deferred', actionId: row.id, duplicate: false, decision };
  }
  if (decision.requiresApproval) {
    await deps.store.update(row.id, { status: 'awaiting_approval' });
    await deps.store.createApproval(row.id, req.ownerUserId, req.inputs);
    return { status: 'awaiting_approval', actionId: row.id, duplicate: false, decision };
  }
  return { status: await execute(row, deps), actionId: row.id, duplicate: false, decision };
}

/**
 * A person approves (optionally with edits) or rejects a queued action. Only the account owner may decide (delegation is
 * a later feature). On approval the guard is asked AGAIN with current facts; if anything changed (kill switch, trial ended,
 * recipient removed from the deal, cap reached) the action is refused, not run.
 */
export async function approveAction(
  actionId: string,
  decidedBy: string,
  deps: ActionDeps,
  opts: { reject?: boolean; editedInputs?: Record<string, unknown> } = {}
): Promise<ActionOutcome | { error: 'not_found' | 'not_owner' | 'not_pending' }> {
  const row = await deps.store.get(actionId);
  if (!row) return { error: 'not_found' };
  if (row.owner_user_id !== decidedBy) return { error: 'not_owner' };
  if (row.status !== 'awaiting_approval') return { error: 'not_pending' }; // a second approve click cannot run it twice

  if (opts.reject) {
    await deps.store.decideApproval(actionId, 'rejected', decidedBy);
    await deps.store.update(actionId, { status: 'cancelled' });
    return { status: 'cancelled', actionId, duplicate: false };
  }

  const inputs = opts.editedInputs ?? row.inputs;
  const recipients = recipientsOfInputs(inputs);
  const req: ActionRequest = {
    ownerUserId: row.owner_user_id,
    transactionId: row.transaction_id,
    listingId: row.listing_id,
    kind: row.kind,
    inputs,
    idempotencyKey: '',
  };
  const decision = evaluateGuard({ kind: row.kind, recipients, approvedByPerson: true }, await deps.loadGuardContext(req));
  await deps.store.decideApproval(actionId, 'approved', decidedBy, opts.editedInputs);
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  if (decision.outcome === 'refuse') {
    await deps.store.update(actionId, { status: 'refused', refusal_reason: decision.reason });
    return { status: 'refused', actionId, duplicate: false, decision };
  }
  if (decision.outcome === 'defer') {
    // Approved, but it is quiet hours: hold it. The runner (not built yet) retries it after the window.
    const next = new Date(new Date(nowIso).getTime() + (deps.deferMinutes ?? 60) * 60_000).toISOString();
    await deps.store.update(actionId, { status: 'deferred', refusal_reason: decision.reason, approved_by: decidedBy, approved_at: nowIso, next_attempt_at: next, ...(opts.editedInputs ? { inputs } : {}) });
    return { status: 'deferred', actionId, duplicate: false, decision };
  }
  // Claim before executing: the status moves off awaiting_approval first, so a concurrent second approval is refused above.
  await deps.store.update(actionId, { status: 'approved', approved_by: decidedBy, approved_at: nowIso, ...(opts.editedInputs ? { inputs } : {}) });
  return { status: await execute({ ...row, inputs, status: 'approved' }, deps), actionId, duplicate: false, decision };
}

/** The flag that lets Auto mode send a routine template reminder is kept with the action, so a later retry still knows it. */
export const TEMPLATE_FLAG = '_fromApprovedTemplate';

/**
 * Runner entry for a claimed deferred action (quiet hours ended, or a retry after a failure). Everything is re-checked with current
 * facts. An action a person already approved runs; one that was only waiting for quiet hours goes back through the normal rules.
 */
export async function resumeAction(actionId: string, deps: ActionDeps): Promise<ActionOutcome | { error: 'not_found' | 'not_deferred' }> {
  const row = await deps.store.get(actionId);
  if (!row) return { error: 'not_found' };
  if (row.status !== 'deferred') return { error: 'not_deferred' };
  const req: ActionRequest = {
    ownerUserId: row.owner_user_id,
    transactionId: row.transaction_id,
    listingId: row.listing_id,
    kind: row.kind,
    inputs: row.inputs,
    fromApprovedTemplate: row.inputs[TEMPLATE_FLAG] === true,
    idempotencyKey: '',
  };
  const decision = evaluateGuard({ kind: row.kind, recipients: recipientsOfInputs(row.inputs), fromApprovedTemplate: req.fromApprovedTemplate, approvedByPerson: Boolean(row.approved_by) }, await deps.loadGuardContext(req));
  const now = (deps.now ?? (() => new Date()))();
  if (decision.outcome === 'refuse') {
    await deps.store.update(row.id, { status: 'refused', refusal_reason: decision.detail ? `${decision.reason}:${decision.detail}` : decision.reason });
    return { status: 'refused', actionId: row.id, duplicate: false, decision };
  }
  if (decision.outcome === 'defer') {
    const next = new Date(now.getTime() + (deps.deferMinutes ?? 60) * 60_000).toISOString();
    await deps.store.update(row.id, { status: 'deferred', refusal_reason: decision.reason, next_attempt_at: next });
    return { status: 'deferred', actionId: row.id, duplicate: false, decision };
  }
  if (decision.requiresApproval && !row.approved_by) {
    await deps.store.update(row.id, { status: 'awaiting_approval', refusal_reason: null, next_attempt_at: null });
    await deps.store.createApproval(row.id, row.owner_user_id, row.inputs);
    return { status: 'awaiting_approval', actionId: row.id, duplicate: false, decision };
  }
  return { status: await execute(row, deps), actionId: row.id, duplicate: false, decision };
}
