import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';

export interface ReminderTransactionGroup {
  transactionId: string;
  label: string;
  overdueTasks: string[];
  dueTodayTasks: string[];
}

const wrapper = (title: string, bodyHtml: string) => `
  <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
    <h2 style="margin: 0 0 16px;">${title}</h2>
    ${bodyHtml}
    <p style="margin-top: 24px;">Thanks,<br/>Relay TC</p>
  </div>
`;

/**
 * Daily digest email to a TC listing checklist tasks that are overdue or
 * due today, across their open deals -- see
 * /api/cron/due-date-reminders, the scheduled job that calls this once a
 * day. This is the proactive half of the due-date system in
 * lib/dueDates.ts: that module only computes a due_date snapshot on each
 * task, it doesn't tell anyone about it. One email per TC per day (not
 * one per task), grouped by deal, so it reads as a morning checklist
 * rather than a flood of notifications.
 */
export async function sendDueDateReminderDigest(params: {
  toEmail: string;
  appUrl: string;
  groups: ReminderTransactionGroup[];
}) {
  const { toEmail, appUrl, groups } = params;

  const totalOverdue = groups.reduce((sum, g) => sum + g.overdueTasks.length, 0);
  const totalDueToday = groups.reduce((sum, g) => sum + g.dueTodayTasks.length, 0);

  const subjectParts: string[] = [];
  if (totalOverdue > 0) subjectParts.push(`${totalOverdue} overdue`);
  if (totalDueToday > 0) subjectParts.push(`${totalDueToday} due today`);
  const subject = `${subjectParts.join(', ')} — Relay TC checklist reminder`;

  const rows = groups
    .map((g) => {
      const items: string[] = [
        ...g.overdueTasks.map(
          (t) =>
            `<li style="color:#991b1b;">${t} <span style="font-weight:600;">(overdue)</span></li>`
        ),
        ...g.dueTodayTasks.map(
          (t) => `<li style="color:#92400e;">${t} <span style="font-weight:600;">(due today)</span></li>`
        ),
      ];
      return `
        <div style="margin-bottom:16px;">
          <p style="margin:0 0 4px;">
            <a href="${appUrl}/dashboard/transactions/${g.transactionId}" style="color:#2563eb;font-weight:600;text-decoration:none;">${g.label}</a>
          </p>
          <ul style="margin:4px 0 0;padding-left:20px;">${items.join('')}</ul>
        </div>`;
    })
    .join('');

  const html = wrapper(
    'Checklist deadlines need your attention',
    `<p>Here's what's due today or overdue across your active deals:</p>
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
