import { addDays } from '../businessDays';
import { fillVars, localDayOf, resolveRecipients, type Step } from './library';

// Pure: turns one automation step into the action request the engine submits. No database, so it is unit-tested.

/** The due date a create/set-due step works out: N days (calendar or business) from today, the closing date, or the trigger's date. */
function dueDateFor(step: Step, vars: Record<string, string>, timeZone: string, now: Date): string | null {
  if (typeof step.dueInDays !== 'number') return null;
  const today = localDayOf(now, timeZone);
  const from = step.dueFrom === 'closing' ? vars.closing_iso : step.dueFrom === 'trigger' ? vars.anchor_iso : today;
  const base = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : today;
  return addDays(base, step.dueBefore ? -step.dueInDays : step.dueInDays, step.businessDays === true);
}

export function stepToRequest(step: Step, vars: Record<string, string>, people: { name: string; email: string | null; role: string; category: string }[], timeZone: string, now: Date): { kind: string; inputs: Record<string, unknown> } {
  switch (step.type) {
    case 'send_email':
      return { kind: 'send_deal_email', inputs: { to: resolveRecipients(step.to ?? [], people), subject: fillVars(step.subject ?? '', vars), message: fillVars(step.message ?? '', vars) } };
    case 'create_task': {
      const inputs: Record<string, unknown> = { name: fillVars(step.name ?? '', vars) };
      const due = dueDateFor(step, vars, timeZone, now);
      if (due) inputs.dueDate = due;
      return { kind: 'create_task', inputs };
    }
    case 'set_task_due':
      return { kind: 'set_task_due', inputs: { taskName: fillVars(step.taskName ?? '', vars), dueDate: dueDateFor(step, vars, timeZone, now) ?? '' } };
    case 'reopen_task':
      return { kind: 'reopen_task', inputs: { taskName: fillVars(step.taskName ?? '', vars) } };
    case 'notify_me':
      return { kind: 'notify_user', inputs: { title: fillVars(step.title ?? '', vars), body: fillVars(step.body ?? '', vars) } };
    default:
      return { kind: 'add_note', inputs: { text: fillVars(step.text ?? '', vars) } };
  }
}

