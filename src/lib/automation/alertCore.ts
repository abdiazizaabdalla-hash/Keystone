import { refusalText, summarizeAction } from './describe';

// Pure: turns one logged automation action into the banner it deserves (or none). No database here, so it is unit-tested.

export type AlertKind = 'approval' | 'reminder' | 'problem';
export interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  at: string;
  automation: string;
}

export const WINDOW_DAYS = 45; // an old reminder nobody acknowledged is history, not a banner
const SYSTEMIC = new Set(['mode_off', 'feature_off', 'kill_switch', 'not_entitled']); // one banner on the Tracker covers these
const EMAIL_KINDS = ['send_deal_email', 'send_step_email'];

export type AlertRow = { id: string; kind: string; status: string; inputs: Record<string, unknown> | null; result: Record<string, unknown> | null; refusal_reason: string | null; created_at: string; executed_at: string | null; instance_id: string | null };

export function alertOf(r: AlertRow, automation: string): Alert | null {
  const inputs = (r.inputs ?? {}) as Record<string, unknown>;
  const acknowledged = Boolean(r.result && (r.result as Record<string, unknown>).acknowledgedAt);
  const at = r.executed_at ?? r.created_at;
  if (r.status === 'awaiting_approval') return { id: r.id, kind: 'approval', title: 'Needs your OK', body: summarizeAction(r.kind, inputs), at, automation };
  if (acknowledged) return null;
  if (r.status === 'executed' && r.kind === 'notify_user') {
    if (r.result && (r.result as Record<string, unknown>).muted) return null;
    const title = typeof inputs.title === 'string' ? inputs.title : 'Reminder';
    return { id: r.id, kind: 'reminder', title, body: typeof inputs.body === 'string' ? inputs.body : '', at, automation };
  }
  if ((r.status === 'refused' || r.status === 'failed') && EMAIL_KINDS.includes(r.kind)) {
    const code = (r.refusal_reason ?? '').split(':')[0];
    if (SYSTEMIC.has(code)) return null;
    return { id: r.id, kind: 'problem', title: 'An email did not go', body: `${summarizeAction(r.kind, inputs)}. ${r.status === 'failed' ? 'It failed; try again from the Tracker.' : refusalText(r.refusal_reason)}`.trim(), at, automation };
  }
  return null;
}

