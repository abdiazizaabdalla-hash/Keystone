'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

interface Item {
  id: string;
  transactionId: string;
  label: string;
  dueDate: string;
  daysUntil: number;
  fileNumber: string;
  propertyAddress: string;
}

// No countdown ("3 days", "Tomorrow"): each row shows its date, and the dot colour says how urgent it is.
function tone(days: number): { dot: string; date: string; overdue: boolean } {
  if (days < 0) return { dot: 'bg-red-400', date: 'text-red-300', overdue: true };
  if (days <= 3) return { dot: 'bg-amber-400', date: 'text-amber-300', overdue: false };
  return { dot: 'bg-blue-400', date: 'text-slate-400', overdue: false };
}

const COLLAPSED_ROWS = 8;

// "Critical dates" across every open deal: contract deadlines (inspection, appraisal, financing, ...) that are
// overdue or due in the next two weeks, shown by date (no countdown). Starts collapsed to one slim line with the counts that matter; open it
// for one thin row per date. Renders nothing until loaded, and nothing at all if there are none, so it never
// adds an empty box to the dashboard.
export default function CriticalDatesCard() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/key-dates/upcoming?days=14');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        // Non-essential widget: stay hidden on any failure.
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  if (!items || items.length === 0) return null;

  const overdue = items.filter((i) => i.daysUntil < 0).length;
  const visible = showAll ? items : items.slice(0, COLLAPSED_ROWS);

  return (
    <div className="mb-6 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-800/60 transition"
      >
        <span className="flex items-center gap-3 min-w-0">
          <svg className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-semibold text-slate-100">Critical dates</span>
          <span className="hidden sm:inline text-xs text-slate-500">Overdue and next 14 days</span>
        </span>
        <span className="flex items-center gap-2 shrink-0 text-xs">
          {overdue > 0 && <span className="px-2 py-0.5 rounded-full border bg-red-900/40 text-red-300 border-red-800">{overdue} overdue</span>}
          <span className="text-slate-400">{items.length} total</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-700">
          <ul className={`divide-y divide-slate-700/60 ${showAll ? 'max-h-[28rem] overflow-y-auto' : ''}`}>
            {visible.map((item) => {
              const c = tone(item.daysUntil);
              return (
                <li key={item.id}>
                  <Link
                    href={`/dashboard/transactions/${item.transactionId}`}
                    className="group flex items-center gap-3 px-4 py-1.5 hover:bg-slate-800/60 transition"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} aria-hidden="true" />
                    <span className="text-sm text-slate-100 group-hover:text-blue-300 transition whitespace-nowrap">{item.label}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                      {item.fileNumber ? `${item.fileNumber} · ` : ''}
                      {item.propertyAddress}
                    </span>
                    {c.overdue && (
                      <span className="text-[11px] leading-5 px-2 rounded-full border whitespace-nowrap shrink-0 bg-red-900/40 text-red-300 border-red-800">Overdue</span>
                    )}
                    <span className={`text-xs whitespace-nowrap tabular-nums shrink-0 ${c.date}`}>{formatDisplayDate(item.dueDate)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-slate-700/60 text-xs">
            {items.length > COLLAPSED_ROWS ? (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-blue-400 hover:text-blue-300">
                {showAll ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            ) : (
              <span />
            )}
            <Link href="/dashboard/calendar" className="text-slate-400 hover:text-slate-200">
              Open calendar →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
