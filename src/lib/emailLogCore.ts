// Pure rules for "has this already been emailed?". No database here, so they are unit-tested.
//
// An automatic email is skipped (not sent twice) when, in the last DUPLICATE_WINDOW_HOURS, a person or another automation
// already emailed one of the same people about the same thing:
//   - the same checklist step, when the email is tied to a step; otherwise
//   - the same subject (case and spacing ignored).

export const DUPLICATE_WINDOW_HOURS = 20;

export interface LoggedEmail {
  task_id: string | null;
  to_emails: string[];
  subject: string;
  sent_at: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function findDuplicate(rows: LoggedEmail[], want: { taskId?: string | null; to: string[]; subject: string }, now: Date, windowHours = DUPLICATE_WINDOW_HOURS): LoggedEmail | null {
  const since = now.getTime() - windowHours * 3600_000;
  const people = new Set(want.to.map(norm));
  const subject = norm(want.subject);
  for (const r of rows) {
    if (Date.parse(r.sent_at) < since) continue;
    if (!r.to_emails.some((a) => people.has(norm(a)))) continue;
    const sameThing = want.taskId ? r.task_id === want.taskId : norm(r.subject) === subject;
    if (sameThing) return r;
  }
  return null;
}
