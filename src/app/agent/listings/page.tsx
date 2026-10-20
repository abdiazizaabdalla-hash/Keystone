'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import { LISTING_STATUS_LABEL, daysOnMarket, type ListingStatus } from '@/lib/listingsShared';

interface AgentListing {
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

const GROUPS: { title: string; statuses: ListingStatus[] }[] = [
  { title: 'On the market', statuses: ['active', 'under_offer'] },
  { title: 'Getting ready', statuses: ['preparing'] },
  { title: 'Under contract', statuses: ['converted'] },
  { title: 'Past listings', statuses: ['expired'] },
];

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-900/40 text-emerald-300',
  under_offer: 'bg-amber-900/40 text-amber-300',
  preparing: 'bg-slate-700 text-slate-300',
  converted: 'bg-blue-900/40 text-blue-300',
  expired: 'bg-slate-700 text-slate-400',
};

// The agent's own Listings tab: every listing their TC is running for them and has chosen to share.
// Read-only; the detail page shows offers, showings, dates and the conversation with the TC.
export default function AgentListingsPage() {
  const router = useRouter();
  const [listings, setListings] = useState<AgentListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/agent/listings');
        if (!res.ok) throw new Error('Failed to load your listings');
        const json = await res.json();
        setListings(Array.isArray(json) ? json : []);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        setError('Could not load your listings. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: listings.filter((l) => g.statuses.includes(l.status)) })).filter((g) => g.items.length > 0),
    [listings]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 md:mb-8">
          <h1 className="text-xl md:text-2xl font-display font-semibold text-slate-100">Your listings</h1>
          <p className="text-slate-400 text-sm mt-0.5">Listings your TC is managing for you: offers, showings, dates and messages. Read-only.</p>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : listings.length === 0 ? (
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center">
            <p className="text-slate-300">No listings yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              When your TC starts a listing for you and shares it, it will show up here. Deals you are on are under{' '}
              <Link href="/agent" className="text-blue-400 hover:text-blue-300">
                Deals
              </Link>
              .
            </p>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.title} className="mb-8">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{g.title}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {g.items.map((l) => {
                  const dom = l.status === 'active' || l.status === 'under_offer' ? daysOnMarket(l.listedOn) : null;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => router.push(`/agent/listings/${l.id}`)}
                      className="text-left bg-slate-700/30 border border-slate-600 rounded-lg p-4 hover:bg-slate-600/30 transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-slate-100 font-semibold leading-snug break-words">{l.propertyAddress}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[l.status] || 'bg-slate-700 text-slate-300'}`}>
                          {LISTING_STATUS_LABEL[l.status] || l.status}
                        </span>
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
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
