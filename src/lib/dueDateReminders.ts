import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';

export interface ReminderTransactionGroup {
  transactionId: string;
  label: string;
  overdueTasks: string[];
  dueTodayTasks: string[];
  dueIn1DayTasks: string[];
  dueIn3DaysTasks: string[];
  dueIn7DaysTasks: string[];
}

const wrapper = (title: string, bodyHtml: string) => `
  <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
    <h2 style="margin: 0 0 16px;">${escapeHtml(title)}</h2>
    ${bodyHtml}
    <p style="margin-top: 24px;">Thanks,<br/>Relay TC</p>
  </div>
`;

/**
 * Daily digest email to a TC listing checklist tasks that need
 * attention across their open deals -- see
 * /api/cron/due-date-reminders, the scheduled job that calls this once
 * a day. This is the proactive half of the due-date system in
 * lib/dueDates.ts: that module only computes a due_date snapshot on each
 * task, it doesn't tell anyone about it.
 *
 * Two kinds of bucket, by design:
 *  - overdueTasks / dueTodayTasks: a *range* match (due_date <= today).
 *    These persist every day a task stays overdue/due-today, which is
 *    the point -- it's meant to keep nagging until resolved.
 *  - dueIn1DayTasks / dueIn3DaysTasks / dueIn7DaysTasks: an *exact* date
 *    match (due_date === today + N). Each one fires on exactly one day
 *    for a given task (the single day its due date happens to be N days
 *    out), so it reads as a one-time advance heads-up rather than a
 *    repeating alarm -- no separate "already sent" tracking needed, the
 *    date math itself prevents duplicates.
 *
 * One email per TC per day (not one per task), grouped by deal, so it
 * reads as a morning checklist rather than a flood of notifications.
 */
export async function sendDueDateReminderDigest(params: {
  toEmail: string;
  appUrl: string;
  groups: ReminderTransactionGroup[];
}) {
  const { toEmail, appUrl, groups } = params;

  const totalOverdue = groups.reduce((sum, g) => sum + g.overdueTasks.length, 0);
  const totalDueToday = groups.reduce((sum, g) => sum + g.dueTodayTasks.length, 0);
  const totalDueIn1Day = groups.reduce((sum, g) => sum + g.dueIn1DayTasks.length, 0);
  const totalDueIn3Days = groups.reduce((sum, g) => sum + g.dueIn3DaysTasks.length, 0);
  const totalDueIn7Days = groups.reduce((sum, g) => sum + g.dueIn7DaysTasks.length, 0);

  const subjectParts: string[] = [];
  if (totalOverdue > 0) subjectParts.push(`${totalOverdue} overdue`);
  if (totalDueToday > 0) subjectParts.push(`${totalDueToday} due today`);
  if (totalDueIn1Day > 0) subjectParts.push(`${totalDueIn1Day} due tomorrow`);
  if (totalDueIn3Days > 0) subjectParts.push(`${totalDueIn3Days} due in 3 days`);
  if (totalDueIn7Days > 0) subjectParts.push(`${totalDueIn7Days} due in 7 days`);
  const subject = `${subjectParts.join(', ')} — Relay TC checklist reminder`;

  const rows = groups
    .map((g) => {
      const items: string[] = [
        ...g.overdueTasks.map(
          (t) =>
            `<li style="color:#991b1b;">${escapeHtml(t)} <span style="font-weight:600;">(overdue)</span></li>`
        ),
        ...g.dueTodayTasks.map(
          (t) => `<li style="color:#92400e;">${escapeHtml(t)} <span style="font-weight:600;">(due today)</span></li>`
        ),
        ...g.dueIn1DayTasks.map(
          (t) => `<li style="color:#92400e;">${escapeHtml(t)} <span style="font-weight:600;">(due tomorrow)</span></li>`
        ),
        ...g.dueIn3DaysTasks.map(
          (t) => `<li style="color:#1e3a8a;">${escapeHtml(t)} <span style="font-weight:600;">(due in 3 days)</span></li>`
        ),
        ...g.dueIn7DaysTasks.map(
          (t) => `<li style="color:#1e3a8a;">${escapeHtml(t)} <span style="font-weight:600;">(due in 7 days)</span></li>`
        ),
      ];
      if (items.length === 0) return '';
      return `
        <div style="margin-bottom:16px;">
          <p style="margin:0 0 4px;">
            <a href="${appUrl}/dashboard/transactions/${g.transactionId}" style="color:#2563eb;font-weight:600;text-decoration:none;">${escapeHtml(g.label)}</a>
          </p>
          <ul style="margin:4px 0 0;padding-left:20px;">${items.join('')}</ul>
        </div>`;
    })
    .join('');

  const html = wrapper(
    'Checklist deadlines need your attention',
    `<p>Here's what needs attention across your active deals:</p>
     ${rows}
     <p><a href="${appUrl}/dashboard/transactions" style="color: #2563eb;">View all transactions</a></p>`
  );

  const resend = getResendClient();
  return resend.emails.send({
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject,
    html,
  });
}
