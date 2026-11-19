// Small pure helpers for the chat screens (kept apart from the components so they can be unit tested).

export function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** The same sender always gets the same colour slot. */
export function colourIndex(key: string, slots: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % slots;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, new Date(now.getTime() - 86400000))) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export const GROUP_MS = 5 * 60 * 1000;

/** A message continues the previous bubble group when it is the same sender, the same day and within five minutes. */
export function continuesGroup(prev: { senderKey: string; createdAt: string } | undefined, cur: { senderKey: string; createdAt: string }): boolean {
  if (!prev || prev.senderKey !== cur.senderKey) return false;
  const a = new Date(prev.createdAt);
  const b = new Date(cur.createdAt);
  return sameDay(a, b) && b.getTime() - a.getTime() < GROUP_MS;
}
