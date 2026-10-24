'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { LISTING_STATUS_LABEL, daysBetween, daysOnMarket, type ListingStatus } from '@/lib/listingsShared';

interface Row {
  id: string;
  property_address: string;
  status: ListingStatus;
  expiration_date: string | null;
  listed_on?: string | null;
  open_offers: number;
  overdue_count: number;
}

// A one-glance view of the listings side of the business. Renders nothing until loaded, and nothing at all when
// there are no open listings, so it never adds an empty box to the dashboard.
export default function ListingsOverviewCard() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/listings');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setRows(data);
      } catch {
        // Non-essential widget: stay hidden on any failure.
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const open = (rows || []).filter((l) => l.status === 'preparing' || l.status === 'active' || l.status === 'under_offer');
  if (open.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const count = (s: ListingStatus) => open.filter((l) => l.status === s).length;
  const live = open.filter((l) => l.status === 'active' || l.status === 'under_offer');
  const doms = live.map((l) => daysOnMarket(l.listed_on, today)).filter((n): n is number => n !== null);
  const avgDom = doms.length ? Math.round(doms.reduce((a, b) => a + b, 0) / doms.length) : null;
  const openOffers = open.reduce((n, l) => n + (l.open_offers || 0), 0);
  const overdue = open.filter((l) => l.overdue_count > 0).length;
  const expiring = open
    .filter((l) => l.expiration_date && l.expiration_date >= today && daysBetween(today, l.expiration_date) <= 30)
    .sort((a, b) => (a.expiration_date as string).localeCompare(b.expiration_date as string));

  const stat = (label: string, value: string | number, tone = 'text-slate-100') => (
    <div className="min-w-[6.5rem]">
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-slate-100">Listings</h2>
        <Link href="/dashboard/listings" className="text-sm text-blue-400 hover:text-blue-300">
          View all
        </Link>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {stat(LISTING_STATUS_LABEL.preparing, count('preparing'))}
        {stat(LISTING_STATUS_LABEL.active, count('active'))}
        {stat(LISTING_STATUS_LABEL.under_offer, count('under_offer'))}
        {avgDom !== null && stat('Avg. days on market', avgDom)}
        {stat('Open offers', openOffers, openOffers > 0 ? 'text-blue-300' : 'text-slate-100')}
        {overdue > 0 && stat('With overdue steps', overdue, 'text-red-300')}
      </div>
      {expiring.length > 0 && (
        <div className="mt-4 border-t border-slate-700 pt-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Listing agreements expiring within 30 days</p>
          <ul className="text-sm space-y-1">
            {expiring.slice(0, 5).map((l) => {
              const d = daysBetween(today, l.expiration_date as string);
              return (
                <li key={l.id}>
                  <Link href={`/dashboard/listings/${l.id}`} className="text-slate-200 hover:text-blue-300">
                    {l.property_address}
                  </Link>
                  <span className={d <= 7 ? 'text-amber-300' : 'text-slate-400'}> · {d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'}`}</span>
                </li>
              );
            })}
            {expiring.length > 5 && <li className="text-xs text-slate-500">+{expiring.length - 5} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
