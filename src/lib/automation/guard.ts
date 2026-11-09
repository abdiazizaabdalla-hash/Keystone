import { ALWAYS_APPROVE_ACTIONS, EXTERNAL_ACTIONS, RESTRICTED_ACTIONS, ACTION_KINDS, type AutomationMode } from './types';

// The one place that decides whether an automation action may run (plan 16.4 item 5). Everything that sends or writes
// passes through `evaluateGuard`. It is pure: the caller loads the facts (mode, today's sends, the deal's people, the
// clock) at EXECUTION time and passes them in, so a saved workflow can never stand in for a permission check.
//
// Decision order matters and is tested: feature off, kill switch, entitlement, restricted, unknown action, mode off,
// recipients, cap, quiet hours, then whether a person must approve.

export interface QuietHours {
  startHour: number; // 0-23, local, inclusive
  endHour: number; // 0-23, local, exclusive
  timeZone: string;
}

export interface GuardRequest {
  kind: string;
  /** Email addresses an external action would reach. */
  recipients?: string[];
  /** True only for an approved template's routine reminder; the one thing Auto mode may send without approval. */
  fromApprovedTemplate?: boolean;
}

export interface GuardContext {
  featureOn: boolean;
  /** Global kill (env) OR the account's own paused switch. */
  killSwitch: boolean;
  /** The workspace owner's plan/trial allows automation (checked now, not when the workflow was saved). */
  entitled: boolean;
  mode: AutomationMode;
  /** Everyone on the deal with an email: the only addresses an email may go to. */
  allowedRecipients: string[];
  /** Emails already sent today for this account/deal, counting the ones this request would add separately. */
  sentToday: number;
  dailySendCap: number;
  quietHours?: QuietHours;
  now: Date;
}

export type GuardRefusal =
  | 'feature_off'
  | 'kill_switch'
  | 'not_entitled'
  | 'restricted_action'
  | 'unknown_action'
  | 'mode_off'
  | 'no_recipients'
  | 'recipient_not_on_deal'
  | 'over_daily_cap';

export type GuardDecision =
  | { outcome: 'allow'; requiresApproval: boolean; approvalReason?: 'draft_mode' | 'contract_dates' | 'not_template' }
  | { outcome: 'refuse'; reason: GuardRefusal; detail?: string }
  | { outcome: 'defer'; reason: 'quiet_hours' };

/** Local hour (0-23) of `now` in an IANA time zone; falls back to UTC if the zone is not recognised. */
export function localHour(now: Date, timeZone: string): number {
  try {
    const part = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).formatToParts(now).find((p) => p.type === 'hour');
    return Number(part?.value) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export function inQuietHours(now: Date, q: QuietHours): boolean {
  const h = localHour(now, q.timeZone);
  if (q.startHour === q.endHour) return false;
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour;
}

export function evaluateGuard(req: GuardRequest, ctx: GuardContext): GuardDecision {
  if (!ctx.featureOn) return { outcome: 'refuse', reason: 'feature_off' };
  if (ctx.killSwitch) return { outcome: 'refuse', reason: 'kill_switch' };
  if (!ctx.entitled) return { outcome: 'refuse', reason: 'not_entitled' };

  if ((RESTRICTED_ACTIONS as readonly string[]).includes(req.kind)) {
    return { outcome: 'refuse', reason: 'restricted_action', detail: req.kind };
  }
  if (!(ACTION_KINDS as readonly string[]).includes(req.kind)) {
    return { outcome: 'refuse', reason: 'unknown_action', detail: req.kind };
  }
  if (ctx.mode === 'off') return { outcome: 'refuse', reason: 'mode_off' };

  const external = EXTERNAL_ACTIONS.includes(req.kind);
  if (external) {
    const to = [...new Set((req.recipients ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
    if (to.length === 0) return { outcome: 'refuse', reason: 'no_recipients' };
    const allowed = new Set(ctx.allowedRecipients.map((a) => a.trim().toLowerCase()));
    const stranger = to.find((a) => !allowed.has(a));
    if (stranger) return { outcome: 'refuse', reason: 'recipient_not_on_deal', detail: stranger };
    if (ctx.sentToday + to.length > ctx.dailySendCap) return { outcome: 'refuse', reason: 'over_daily_cap' };
    if (ctx.quietHours && inQuietHours(ctx.now, ctx.quietHours)) return { outcome: 'defer', reason: 'quiet_hours' };
  }

  if (ALWAYS_APPROVE_ACTIONS.includes(req.kind)) return { outcome: 'allow', requiresApproval: true, approvalReason: 'contract_dates' };
  if (external) {
    if (ctx.mode === 'draft') return { outcome: 'allow', requiresApproval: true, approvalReason: 'draft_mode' };
    if (!req.fromApprovedTemplate) return { outcome: 'allow', requiresApproval: true, approvalReason: 'not_template' };
  }
  return { outcome: 'allow', requiresApproval: false };
}
