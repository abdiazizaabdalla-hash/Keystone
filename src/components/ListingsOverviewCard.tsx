'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { LISTING_STATUS_LABEL, daysBetween, daysOnMarket, type ListingStatus } from '@/lib/listingsShared';

interface Row {
  id: string;
  property_address: string;
  seller_name?: string | null;
  list_price?: number | null;
  status: ListingStatus;
  expiration_date: string | null;
  listed_on?: string | null;
  tasks_total?: number;
  tasks_done?: number;
  next_due_date?: string | null;
  open_offers: number;
  overdue_count: number;
}

const COLLAPSED_ROWS = 8;
const OPEN_STATUSES: ListingStatus[] = ['preparing', 'active', 'under_offer'];

const STATUS_CHIP: Record<string, { cls: string; dot: string }> = {
  preparing: { cls: 'bg-amber-900/40 text-amber-300 border-amber-800', dot: 'bg-amber-400' },
  active: { cls: 'bg-green-900/40 text-green-300 border-green-800', dot: 'bg-green-400' },
  under_offer: { cls: 'bg-blue-900/40 text-blue-300 border-blue-800', dot: 'bg-blue-400' },
};

const money = (n?: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '');

// "Listings" on the dashboard, set up like Critical dates: open by default, one thin row per open listing with
// its details, and the header line collapses it. Sits right under Active Transactions. Hidden until loaded
// (and on any load failure); with no open listings it shows a short empty state pointing to the Listings tab.
export default function ListingsOverviewCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/listings');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setRows(data);
    } catch {
      // Non-essential widget: stay hidden on any failure.
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (rows === null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const list = rows
    .filter((l) => OPEN_STATUSES.includes(l.status))
    // Needs-attention first: most overdue steps, then the soonest next step.
    .sort((a, b) => b.overdue_count - a.overdue_count || (a.next_due_date || '9999').localeCompare(b.next_due_date || '9999'));

  const live = list.filter((l) => l.status === 'active' || l.status === 'under_offer');
  const doms = live.map((l) => daysOnMarket(l.listed_on, today)).filter((n): n is number => n !== null);
  const avgDom = doms.length ? Math.round(doms.reduce((a, b) => a + b, 0) / doms.length) : null;
  const openOffers = list.reduce((n, l) => n + (l.open_offers || 0), 0);
  const withOverdue = list.filter((l) => l.overdue_count > 0).length;
  const visible = showAll ? list : list.slice(0, COLLAPSED_ROWS);

  if (list.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">Listings</p>
            <p className="text-xs text-slate-500">No open listings yet. Start one from the Listings tab, where you can also import a CSV.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link href="/dashboard/listings" className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white font-semibold transition">
              Go to Listings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
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
          <span className="text-sm font-semibold text-slate-100">Listings</span>
          <span className="hidden sm:inline text-xs text-slate-500">
            Open listings{avgDom !== null ? ` · avg. ${avgDom} days on market` : ''}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0 text-xs">
          {withOverdue > 0 && <span className="px-2 py-0.5 rounded-full border bg-red-900/40 text-red-300 border-red-800">{withOverdue} with overdue steps</span>}
          {openOffers > 0 && (
            <span className="px-2 py-0.5 rounded-full border bg-blue-900/40 text-blue-300 border-blue-800">
              {openOffers} open offer{openOffers === 1 ? '' : 's'}
            </span>
          )}
          <span className="text-slate-400">{list.length} total</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-700">
          <ul className={`divide-y divide-slate-700/60 ${showAll ? 'max-h-[28rem] overflow-y-auto' : ''}`}>
            {visible.map((l) => {
              const chip = STATUS_CHIP[l.status] || STATUS_CHIP.preparing;
              const exp = l.expiration_date && l.expiration_date >= today ? daysBetween(today, l.expiration_date) : null;
              const expiring = exp !== null && exp <= 30;
              const sub = [l.seller_name, money(l.list_price)].filter(Boolean).join(' · ');
              return (
                <li key={l.id}>
                  <Link href={`/dashboard/listings/${l.id}`} className="group flex items-center gap-3 px-4 py-1.5 hover:bg-slate-800/60 transition">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chip.dot}`} aria-hidden="true" />
                    <span className="min-w-0 truncate text-sm text-slate-100 group-hover:text-blue-300 transition">{l.property_address}</span>
                    {sub && <span className="hidden md:block min-w-0 flex-1 truncate text-xs text-slate-500">{sub}</span>}
                    {!sub && <span className="hidden md:block flex-1" />}
                    {!!l.tasks_total && (
                      <span className="hidden sm:inline text-xs text-slate-400 whitespace-nowrap tabular-nums">
                        {l.tasks_done}/{l.tasks_total} steps
                      </span>
                    )}
                    {l.overdue_count > 0 && (
                      <span className="text-[11px] leading-5 px-2 rounded-full border whitespace-nowrap shrink-0 bg-red-900/40 text-red-300 border-red-800">
                        {l.overdue_count} overdue
                      </span>
                    )}
                    {l.open_offers > 0 && (
                      <span className="text-[11px] leading-5 px-2 rounded-full border whitespace-nowrap shrink-0 bg-blue-900/40 text-blue-300 border-blue-800">
                        {l.open_offers} offer{l.open_offers === 1 ? '' : 's'}
                      </span>
                    )}
                    {expiring && (
                      <span className="hidden lg:inline text-[11px] leading-5 px-2 rounded-full border whitespace-nowrap shrink-0 bg-amber-900/40 text-amber-300 border-amber-800">
                        Expires {exp === 0 ? 'today' : `in ${exp}d`}
                      </span>
                    )}
                    <span className={`text-[11px] leading-5 px-2 rounded-full border whitespace-nowrap shrink-0 ${chip.cls}`}>{LISTING_STATUS_LABEL[l.status]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-slate-700/60 text-xs">
            {list.length > COLLAPSED_ROWS ? (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-blue-400 hover:text-blue-300">
                {showAll ? 'Show fewer' : `Show all ${list.length}`}
              </button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-3">
              <Link href="/dashboard/listings" className="text-slate-400 hover:text-slate-200">
                View all listings →
              </Link>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
