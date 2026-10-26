'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

export interface AttentionDueItem {
  // Set for listing items, which don't live under /transactions.
  href?: string;
  taskId: string;
  taskName: string;
  transactionId: string;
  label: string;
  // Set only for a team/brokerage owner viewing a rolled-up team-wide
  // list -- null for a solo TC's own view, where every item is already
  // theirs and a label would be redundant.
  tcLabel: string | null;
}

export interface AttentionOverdueItem extends AttentionDueItem {
  daysOverdue: number;
}

export interface AttentionDueSoonItem extends AttentionDueItem {
  dueInDays: number;
}

export interface AttentionWaitingOnItem extends AttentionDueItem {
  waitingOn: string;
  daysSince: number;
}

export interface AttentionClosingSoonItem {
  transactionId: string;
  label: string;
  closingDate: string;
  daysUntil: number;
  tcLabel: string | null;
}

export interface AttentionSummary {
  overdue: AttentionOverdueItem[];
  dueToday: AttentionDueItem[];
  dueSoon: AttentionDueSoonItem[];
  waitingOn: AttentionWaitingOnItem[];
  closingsSoon: AttentionClosingSoonItem[];
  totalNeedsAttention: number;
  /** How many items this person has dismissed (hidden from the lists above). */
  dismissedCount?: number;
}

// ---- Needs Attention Today ------------------------------------------------
// Four count tiles act as tabs, and only the chosen list is shown below,
// grouped by deal so an address that has ten overdue steps appears once with
// its steps underneath instead of ten times.

type AttentionTab = 'overdue' | 'today' | 'waiting' | 'soon';

// Static class strings (Tailwind can't see dynamically built names).
const ATTENTION_TONES: Record<AttentionTab, { number: string; active: string; chip: string; dot: string }> = {
  overdue: {
    number: 'text-red-400',
    active: 'border-red-500/60 bg-red-500/10',
    chip: 'bg-red-900/30 border-red-700/60 text-red-300',
    dot: 'bg-red-400',
  },
  today: {
    number: 'text-amber-400',
    active: 'border-amber-500/60 bg-amber-500/10',
    chip: 'bg-amber-900/30 border-amber-700/60 text-amber-300',
    dot: 'bg-amber-400',
  },
  waiting: {
    number: 'text-orange-400',
    active: 'border-orange-500/60 bg-orange-500/10',
    chip: 'bg-orange-900/30 border-orange-700/60 text-orange-300',
    dot: 'bg-orange-400',
  },
  soon: {
    number: 'text-blue-400',
    active: 'border-blue-500/60 bg-blue-500/10',
    chip: 'bg-blue-900/30 border-blue-700/60 text-blue-300',
    dot: 'bg-blue-400',
  },
};

// "Listing · 4821 Juniper Hollow Drive, Austin, TX 78738" ->
// { tag: 'Listing', street: '4821 Juniper Hollow Drive', area: 'Austin, TX 78738' }
function splitDealLabel(label: string) {
  const i = label.indexOf(' · ');
  const tag = i >= 0 ? label.slice(0, i) : '';
  const place = i >= 0 ? label.slice(i + 3) : label;
  const c = place.indexOf(',');
  return {
    tag,
    street: c >= 0 ? place.slice(0, c) : place,
    area: c >= 0 ? place.slice(c + 1).trim() : '',
    full: place,
  };
}

const whenLabel = (days: number) => (days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);

interface AttentionRow {
  id: string;
  text: string;
  chip: string;
  href: string;
}
interface AttentionGroup {
  key: string;
  label: string;
  tcLabel: string | null;
  href: string;
  rows: AttentionRow[];
}

function buildGroups<T extends AttentionDueItem>(
  items: T[],
  toRow: (item: T) => { text: string; chip: string }
): AttentionGroup[] {
  const map = new Map<string, AttentionGroup>();
  for (const item of items) {
    const href = item.href || `/dashboard/transactions/${item.transactionId}`;
    const key = `${item.label}|${item.tcLabel ?? ''}`;
    let g = map.get(key);
    if (!g) {
      g = { key, label: item.label, tcLabel: item.tcLabel, href, rows: [] };
      map.set(key, g);
    }
    g.rows.push({ id: item.taskId, href, ...toRow(item) });
  }
  return [...map.values()];
}

const DEALS_COLLAPSED = 4;
const ROWS_PER_DEAL = 4;

export default function AttentionPanel({
  attention,
  onDismiss,
  onRestore,
}: {
  attention: AttentionSummary;
  /** Hide one item (its id is the task id, or closing-<deal id>). */
  onDismiss?: (id: string) => void | Promise<void>;
  /** Bring one item back, or everything dismissed. */
  onRestore?: (id: string | 'all') => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<AttentionTab | null>(null);
  const [showAll, setShowAll] = useState(false);
  // The last thing dismissed stays undoable for a few seconds.
  const [lastDismissed, setLastDismissed] = useState<{ id: string; text: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = (id: string, text: string) => {
    if (!onDismiss) return;
    void onDismiss(id);
    setLastDismissed({ id, text });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLastDismissed(null), 8000);
  };
  const undoDismiss = () => {
    if (!lastDismissed || !onRestore) return;
    void onRestore(lastDismissed.id);
    setLastDismissed(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };
  const dismissedCount = attention.dismissedCount ?? 0;

  const counts: Record<AttentionTab, number> = {
    overdue: attention.overdue.length,
    today: attention.dueToday.length,
    waiting: attention.waitingOn.length,
    soon: attention.dueSoon.length + attention.closingsSoon.length,
  };
  // Open on the most urgent list that has anything in it.
  const firstWithItems = (['overdue', 'today', 'waiting', 'soon'] as AttentionTab[]).find((t) => counts[t] > 0);
  const tab: AttentionTab = picked ?? firstWithItems ?? 'overdue';

  const groupsFor = (t: AttentionTab): AttentionGroup[] => {
    if (t === 'overdue') {
      return buildGroups(
        [...attention.overdue].sort((a, b) => b.daysOverdue - a.daysOverdue),
        (i) => ({ text: i.taskName, chip: `${i.daysOverdue}d late` })
      );
    }
    if (t === 'today') {
      return buildGroups(attention.dueToday, (i) => ({ text: i.taskName, chip: 'Today' }));
    }
    if (t === 'waiting') {
      return buildGroups(
        [...attention.waitingOn].sort((a, b) => b.daysSince - a.daysSince),
        (i) => ({ text: `${i.taskName} — waiting on ${i.waitingOn}`, chip: `${i.daysSince}d` })
      );
    }
    const closings = buildGroups(
      attention.closingsSoon.map((c) => ({
        taskId: `closing-${c.transactionId}`,
        taskName: 'Closing',
        transactionId: c.transactionId,
        label: c.label,
        tcLabel: c.tcLabel,
        daysUntil: c.daysUntil,
      })),
      (i) => ({ text: i.taskName, chip: whenLabel(i.daysUntil) })
    );
    const deadlines = buildGroups(
      [...attention.dueSoon].sort((a, b) => a.dueInDays - b.dueInDays),
      (i) => ({ text: i.taskName, chip: whenLabel(i.dueInDays) })
    );
    return [...closings, ...deadlines];
  };

  const groups = groupsFor(tab);
  const visibleGroups = showAll ? groups : groups.slice(0, DEALS_COLLAPSED);
  const hiddenDeals = groups.length - visibleGroups.length;

  const tiles: { id: AttentionTab; label: string; hint: string }[] = [
    {
      id: 'overdue',
      label: 'Overdue',
      hint:
        counts.overdue === 0
          ? 'Nothing overdue'
          : (() => {
              const n = buildGroups(attention.overdue, () => ({ text: '', chip: '' })).length;
              return `${n} ${n === 1 ? 'deal' : 'deals'}`;
            })(),
    },
    {
      id: 'today',
      label: 'Due today',
      hint: counts.today === 0 ? 'Nothing due' : 'Finish today',
    },
    {
      id: 'waiting',
      label: 'Waiting on',
      hint: counts.waiting === 0 ? 'Nothing stuck' : 'Needs a nudge',
    },
    {
      id: 'soon',
      label: 'Coming up',
      hint:
        attention.closingsSoon.length > 0
          ? `${attention.closingsSoon.length} closing${attention.closingsSoon.length !== 1 ? 's' : ''} this week`
          : counts.soon === 0
          ? 'Nothing soon'
          : 'Next 3 days',
    },
  ];

  const emptyText: Record<AttentionTab, string> = {
    overdue: 'Nothing is overdue. Nice work.',
    today: 'Nothing is due today.',
    waiting: 'Nothing is stuck waiting on someone.',
    soon: 'No closings or deadlines coming up.',
  };

  return (
    <div className="@container bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-slate-100">Needs attention today</h2>
        {attention.totalNeedsAttention === 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-900/30 border border-green-700 text-green-300 whitespace-nowrap">
            All caught up
          </span>
        )}
      </div>

      <div role="tablist" aria-label="Attention categories" className="grid grid-cols-2 @md:grid-cols-4 gap-3 mb-4">
        {tiles.map((t) => {
          const tone = ATTENTION_TONES[t.id];
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setPicked(t.id);
                setShowAll(false);
              }}
              className={`text-left rounded-xl border px-3 @md:px-3.5 py-3 transition ${
                active ? (counts[t.id] > 0 ? tone.active : 'border-white/20 bg-white/5') : 'border-white/10 bg-slate-900/30 hover:bg-white/5'
              }`}
            >
              <div className="text-xs font-medium text-slate-400">{t.label}</div>
              <div className={`text-3xl font-bold leading-tight ${counts[t.id] > 0 ? tone.number : 'text-slate-600'}`}>
                {counts[t.id]}
              </div>
              <div className="text-xs text-slate-500 truncate">{t.hint}</div>
            </button>
          );
        })}
      </div>

      {groups.length === 0 ? (
        <p role="tabpanel" className="text-sm text-slate-500 py-4 text-center">
          {emptyText[tab]}
        </p>
      ) : (
        <div role="tabpanel" className="space-y-3">
          {visibleGroups.map((g) => {
            const d = splitDealLabel(g.label);
            const tone = ATTENTION_TONES[tab];
            return (
              <div key={g.key} className="rounded-xl bg-slate-900/40 border border-white/5 overflow-hidden">
                <Link
                  href={g.href}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 pt-3 pb-1.5 hover:bg-white/5 transition"
                  title={d.full}
                >
                  <span className="font-semibold text-slate-100 text-sm">{d.street}</span>
                  {d.tag && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-slate-600 text-slate-400">
                      {d.tag}
                    </span>
                  )}
                  {d.area && <span className="text-xs text-slate-500">{d.area}</span>}
                  {g.tcLabel && <span className="text-xs text-slate-500">· {g.tcLabel}</span>}
                  <span className="ml-auto text-xs text-slate-500">
                    {g.rows.length} {g.rows.length === 1 ? 'item' : 'items'}
                  </span>
                </Link>
                <ul className="px-2 pb-2">
                  {g.rows.slice(0, ROWS_PER_DEAL).map((r) => (
                    <li key={r.id} className="group/row flex items-center gap-1 rounded-lg hover:bg-white/5 transition">
                      <Link
                        href={r.href}
                        className="flex flex-1 min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-300 group-hover/row:text-slate-100 transition"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
                          <span className="truncate">{r.text}</span>
                        </span>
                        <span
                          className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${tone.chip}`}
                        >
                          {r.chip}
                        </span>
                      </Link>
                      {onDismiss && (
                        <button
                          type="button"
                          onClick={() => dismiss(r.id, r.text)}
                          title="Dismiss from this list (the task itself is not changed)"
                          aria-label={`Dismiss ${r.text}`}
                          className="shrink-0 mr-1 w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-100 hover:bg-white/10 focus-visible:text-slate-100 transition"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                  {g.rows.length > ROWS_PER_DEAL && (
                    <li>
                      <Link
                        href={g.href}
                        className="block px-2 py-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        +{g.rows.length - ROWS_PER_DEAL} more in this deal
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
          {(hiddenDeals > 0 || showAll) && groups.length > DEALS_COLLAPSED && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {showAll ? 'Show fewer deals' : `Show ${hiddenDeals} more ${hiddenDeals === 1 ? 'deal' : 'deals'}`}
            </button>
          )}
        </div>
      )}

      {(lastDismissed || dismissedCount > 0) && onRestore && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
          {lastDismissed ? (
            <span className="min-w-0 truncate" role="status">
              Dismissed “{lastDismissed.text}”.{' '}
              <button type="button" onClick={undoDismiss} className="text-blue-400 hover:text-blue-300 font-medium">
                Undo
              </button>
            </span>
          ) : (
            <span />
          )}
          {dismissedCount > 0 && (
            <span>
              {dismissedCount} dismissed ·{' '}
              <button type="button" onClick={() => void onRestore('all')} className="text-blue-400 hover:text-blue-300">
                Restore all
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
