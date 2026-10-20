'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import AgentListingCard, { type AgentListingSummary as AgentListing } from '@/components/AgentListingCard';
import type { ListingStatus } from '@/lib/listingsShared';

const GROUPS: { title: string; statuses: ListingStatus[] }[] = [
  { title: 'On the market', statuses: ['active', 'under_offer'] },
  { title: 'Getting ready', statuses: ['preparing'] },
  { title: 'Under contract', statuses: ['converted'] },
  { title: 'Past listings', statuses: ['expired'] },
];

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
    <div className="p-4 md:p-8 max-w-6xl">
      <div>
        <div className="mb-5 md:mb-8">
          <h1 className="text-xl md:text-2xl font-display font-semibold text-slate-100">Your listings</h1>
          <p className="text-slate-400 text-sm mt-0.5">Listings your TC is managing for you: offers, showings, dates and messages. Read-only.</p>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : listings.length === 0 ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8 text-center">
            <p className="text-slate-300">No listings yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              When your TC starts a listing for you and shares it, it will show up here. Deals you are on are on your{' '}
              <Link href="/agent" className="text-blue-400 hover:text-blue-300">
                Dashboard
              </Link>
              .
            </p>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.title} className="mb-8">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{g.title}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {g.items.map((l) => (
                  <AgentListingCard key={l.id} listing={l} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
