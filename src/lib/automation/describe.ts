// Plain-language text for actions and refusals, shared by the API and the screens. Pure.

const KIND_LABELS: Record<string, string> = {
  create_task: 'Add a task',
  add_note: 'Add a note',
  suggest_tick: 'Tick off a step',
  classify_document: 'File a document under a type',
  file_document: 'Move a document',
  set_date: 'Change a contract date',
  send_step_email: 'Send a step email',
  send_deal_email: 'Send an email',
  send_briefing: 'Send your daily briefing',
  notify_user: 'Notify you',
};

const REFUSALS: Record<string, string> = {
  feature_off: 'Automation is switched off.',
  kill_switch: 'Automation is paused for your account.',
  not_entitled: 'Your plan or trial does not include automation.',
  restricted_action: 'Relay never does this on its own.',
  unknown_action: 'Relay does not know this action.',
  mode_off: 'The assistant is Off for this deal.',
  no_recipients: 'There was nobody to send it to.',
  recipient_not_on_deal: 'That address is not on this deal, so Relay would not send to it.',
  over_daily_cap: 'The daily send limit for this deal was reached.',
  quiet_hours: 'Held until quiet hours end.',
  not_implemented: 'Relay cannot do this yet.',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

/** `refusal_reason` is stored as `reason` or `reason:detail`. */
export function refusalText(reason: string | null | undefined): string {
  if (!reason) return '';
  const [code, detail] = reason.split(':');
  const base = REFUSALS[code] ?? code.replace(/_/g, ' ');
  return detail && code === 'recipient_not_on_deal' ? `${base} (${detail})` : base;
}

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** One line saying what the action is, from its inputs. */
export function summarizeAction(kind: string, inputs: Record<string, unknown>): string {
  switch (kind) {
    case 'send_deal_email':
    case 'send_step_email': {
      const to = Array.isArray(inputs.to) ? (inputs.to as unknown[]).filter((a): a is string => typeof a === 'string').join(', ') : '';
      return `${str(inputs.subject) || 'Email'}${to ? ` to ${to}` : ''}`;
    }
    case 'create_task':
      return str(inputs.name) || 'New task';
    case 'add_note':
      return str(inputs.text, 140) || 'Note';
    case 'suggest_tick':
      return str(inputs.name) || str(inputs.reason) || 'Step';
    case 'set_date':
      return `${str(inputs.field) === 'acceptance_date' ? 'Acceptance' : 'Closing'} date to ${str(inputs.date)}`;
    case 'notify_user':
      return str(inputs.title) || 'Notification';
    case 'send_briefing':
      return str(inputs.subject) || 'Daily briefing';
    default:
      return '';
  }
}

/** Fields a person may change before approving, per kind. Anything else in an edit is ignored. */
export const EDITABLE_FIELDS: Record<string, readonly string[]> = {
  send_deal_email: ['subject', 'message', 'to'],
  send_step_email: ['subject', 'message', 'to'],
  create_task: ['name', 'dueDate'],
  add_note: ['text'],
  set_date: ['date'],
};

export function pickEdits(kind: string, current: Record<string, unknown>, edits: unknown): Record<string, unknown> {
  const allowed = EDITABLE_FIELDS[kind] ?? [];
  const next: Record<string, unknown> = { ...current };
  if (typeof edits !== 'object' || edits === null) return next;
  for (const key of allowed) {
    const v = (edits as Record<string, unknown>)[key];
    if (key === 'to') {
      if (Array.isArray(v)) next.to = v.filter((a): a is string => typeof a === 'string').slice(0, 10);
    } else if (typeof v === 'string') {
      next[key] = v.slice(0, key === 'message' || key === 'text' ? 10000 : 255);
    }
  }
  return next;
}
