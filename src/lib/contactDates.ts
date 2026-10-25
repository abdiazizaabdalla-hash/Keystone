// Small date helpers for the Contacts CRM screens.

/** Today as YYYY-MM-DD in the viewer's own time zone. */
export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "today", "3 days ago", "2 months ago" for a past timestamp. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** "Oct 24, 2026" for a YYYY-MM-DD date or a timestamp. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** How a due date reads: "Overdue by 3 days", "Due today", "Due in 5 days". */
export function dueLabel(dueOn: string, today = todayLocal()): { text: string; overdue: boolean } {
  const diff = Math.round((new Date(`${dueOn}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
  if (diff < 0) return { text: `Overdue by ${-diff} day${diff === -1 ? '' : 's'}`, overdue: true };
  if (diff === 0) return { text: 'Due today', overdue: false };
  return { text: `Due in ${diff} day${diff === 1 ? '' : 's'}`, overdue: false };
}
