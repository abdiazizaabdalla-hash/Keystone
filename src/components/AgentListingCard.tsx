'use client';

import Link from 'next/link';
import { formatDisplayDate } from '@/lib/dueDates';
import { LISTING_STATUS_LABEL, daysOnMarket, type ListingStatus } from '@/lib/listingsShared';

export interface AgentListingSummary {
  id: string;
  propertyAddress: string;
  status: ListingStatus;
  listPrice: number | null;
  plannedListDate: string | null;
  expirationDate: string | null;
  listedOn: string | null;
  openOffers: number;
  showings: number;
  tcLabel: string;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-900/40 text-emerald-300',
  under_offer: 'bg-amber-900/40 text-amber-300',
  preparing: 'bg-slate-700 text-slate-300',
  converted: 'bg-blue-900/40 text-blue-300',
  expired: 'bg-slate-700 text-slate-400',
};

// One listing as a card: used on the agent dashboard and on the Listings tab.
export default function AgentListingCard({ listing: l }: { listing: AgentListingSummary }) {
  const dom = l.status === 'active' || l.status === 'under_offer' ? daysOnMarket(l.listedOn) : null;
  return (
    <Link
      href={`/agent/listings/${l.id}`}
      className="block text-left bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-slate-700/40 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-slate-100 font-semibold leading-snug break-words">{l.propertyAddress}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[l.status] || 'bg-slate-700 text-slate-300'}`}>{LISTING_STATUS_LABEL[l.status] || l.status}</span>
      </div>
      <p className="text-sm text-slate-300 mt-1">
        {l.listPrice ? `$${Number(l.listPrice).toLocaleString('en-US')}` : 'Price not set'}
        {dom !== null ? <span className="text-slate-500"> · {dom} days on market</span> : null}
      </p>
      <p className="text-xs text-slate-500 mt-2">
        {[
          l.openOffers > 0 ? `${l.openOffers} open offer${l.openOffers === 1 ? '' : 's'}` : '',
          `${l.showings} showing${l.showings === 1 ? '' : 's'}`,
          l.status === 'preparing' && l.plannedListDate ? `going live ${formatDisplayDate(l.plannedListDate)}` : '',
          l.expirationDate ? `expires ${formatDisplayDate(l.expirationDate)}` : '',
          l.tcLabel,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </Link>
  );
}
