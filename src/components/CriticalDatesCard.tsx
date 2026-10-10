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

function chip(days: number): { text: string; cls: string } {
  if (days < 0) return { text: `${-days}d overdue`, cls: 'bg-red-900/40 text-red-300 border-red-700' };
  if (days === 0) return { text: 'Today', cls: 'bg-amber-900/40 text-amber-300 border-amber-700' };
  if (days === 1) return { text: 'Tomorrow', cls: 'bg-amber-900/40 text-amber-300 border-amber-700' };
  if (days <= 3) return { text: `In ${days} days`, cls: 'bg-amber-900/40 text-amber-300 border-amber-700' };
  return { text: `In ${days} days`, cls: 'bg-blue-900/40 text-blue-300 border-blue-700' };
}

// "Critical dates" across every open deal: contract deadlines (inspection,
// appraisal, financing, ...) that are overdue or due in the next two weeks.
// Renders nothing until loaded, and nothing at all if there are none, so it
// never adds an empty box to the dashboard.
export default function CriticalDatesCard() {
  const [items, setItems] = useState<Item[] | null>(null);
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
  const visible = showAll ? items : items.slice(0, 6);

  return (
    <div className="mb-8 bg-gradient-to-br from-slate-800/80 to-slate-800/40 border border-slate-700 rounded-lg p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold text-slate-100">Critical dates</h2>
        <span className="text-xs text-slate-400">Overdue and next 14 days</span>
      </div>
      <ul className="divide-y divide-slate-700">
        {visible.map((item) => {
          const c = chip(item.daysUntil);
          return (
            <li key={item.id} className="py-2 flex items-center justify-between gap-3">
              <Link href={`/dashboard/transactions/${item.transactionId}`} className="min-w-0 group">
                <p className="text-sm text-slate-100 truncate group-hover:text-blue-300 transition">{item.label}</p>
                <p className="text-xs text-slate-400 truncate">
                  {item.fileNumber ? `${item.fileNumber} · ` : ''}
                  {item.propertyAddress} · {formatDisplayDate(item.dueDate)}
                </p>
              </Link>
              <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${c.cls}`}>{c.text}</span>
            </li>
          );
        })}
      </ul>
      {items.length > 6 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
