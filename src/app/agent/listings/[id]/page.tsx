'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import ListingThread from '@/components/ListingThread';
import { LISTING_STATUS_LABEL, daysOnMarket, SHOWING_INTEREST_LABEL, SHOWING_KIND_LABEL, type ListingStatus } from '@/lib/listingsShared';

interface Detail {
  listing: {
    id: string;
    propertyAddress: string;
    status: ListingStatus;
    listPrice: number | null;
    plannedListDate: string | null;
    expirationDate: string | null;
    mlsNumber: string | null;
    mlsUrl: string | null;
    sellerName: string | null;
    listedOn?: string | null;
    convertedTransactionId?: string | null;
  };
  tcLabel: string;
  dates: { id: string; label: string; due_date: string }[];
  offers: {
    id: string;
    buyerName: string | null;
    buyerAgent: string | null;
    offerPrice: number | null;
    status: string;
    receivedOn: string | null;
    financing: string | null;
    earnestMoney: number | null;
    optionDays: number | null;
    closingDate: string | null;
    sellerConcessions: number | null;
    offerExpires: string | null;
    possession: string | null;
    contingencies: string | null;
    terms: string | null;
  }[];
  showings: { id: string; showing_date: string; kind: string; visitor: string | null; interest: string | null; feedback: string | null }[];
  priceChanges: { id: string; old_price: number | null; new_price: number; changed_on: string; note: string | null }[];
}

const money = (n: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '—');
const card = 'bg-slate-700/30 border border-slate-600 rounded-lg p-5';
const OFFER_LABEL: Record<string, string> = { received: 'Received', countered: 'Countered', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };

// The listing agent's read-only view of a listing their TC is running: where it stands, offers, showings,
// price history and key dates. The TC's checklist, notes and documents stay with the TC.
export default function AgentListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/api/agent/listings/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load this listing');
        setData(json);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load this listing');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-slate-400 text-sm">Loading…</div>;
  if (error || !data)
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
        <Link href="/agent/listings" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to your listings
        </Link>
        <p className="mt-4 text-red-400 text-sm">{error || 'Listing not found'}</p>
      </div>
    );

  const { listing, offers, showings, priceChanges, dates } = data;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-6 md:px-6 md:py-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <Link href="/agent/listings" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to your listings
        </Link>
        <div>
          <h1 className="text-2xl font-display font-semibold text-slate-100 break-words">{listing.propertyAddress}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {LISTING_STATUS_LABEL[listing.status]} · {money(listing.listPrice)}
            {(listing.status === 'active' || listing.status === 'under_offer') && daysOnMarket(listing.listedOn) !== null ? ` · ${daysOnMarket(listing.listedOn)} days on market` : ''}
            {listing.sellerName ? ` · Seller: ${listing.sellerName}` : ''} · Managed by {data.tcLabel}
          </p>
          {(listing.mlsUrl || listing.mlsNumber) && (
            <p className="text-sm mt-1">
              {listing.mlsUrl ? (
                <a href={listing.mlsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                  View listing{listing.mlsNumber ? ` (MLS ${listing.mlsNumber})` : ''}
                </a>
              ) : (
                <span className="text-slate-400">MLS {listing.mlsNumber}</span>
              )}
            </p>
          )}
        </div>

        {listing.convertedTransactionId && (
          <Link
            href={`/agent/transactions/${listing.convertedTransactionId}`}
            className="flex items-center justify-between gap-3 bg-emerald-900/20 border border-emerald-700/50 rounded-lg px-4 py-3 text-sm hover:bg-emerald-900/30 transition"
          >
            <span className="text-slate-200">This listing is now under contract.</span>
            <span className="text-emerald-300 shrink-0">Open the deal →</span>
          </Link>
        )}

        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-3">Key dates</h2>
          <ul className="text-sm space-y-1">
            {listing.plannedListDate && (
              <li className="flex justify-between gap-3 text-slate-300">
                <span>{listing.plannedListDate > today ? 'Planned list date' : 'List date'}</span>
                <span>{formatDisplayDate(listing.plannedListDate)}</span>
              </li>
            )}
            {listing.expirationDate && (
              <li className="flex justify-between gap-3 text-slate-300">
                <span>Listing expires</span>
                <span>{formatDisplayDate(listing.expirationDate)}</span>
              </li>
            )}
            {dates.map((d) => (
              <li key={d.id} className="flex justify-between gap-3 text-slate-300">
                <span>{d.label}</span>
                <span>{formatDisplayDate(d.due_date)}</span>
              </li>
            ))}
            {!listing.plannedListDate && !listing.expirationDate && dates.length === 0 && <li className="text-slate-500">No dates yet.</li>}
          </ul>
        </div>

        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-3">Offers</h2>
          {offers.length === 0 && <p className="text-sm text-slate-500">No offers yet.</p>}
          <div className="space-y-3">
            {offers.map((o) => (
              <div key={o.id} className="border border-slate-600 rounded-lg p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-slate-100 font-medium break-words">
                    {o.buyerName || 'Buyer'} {o.offerPrice ? <span className="text-slate-300">· {money(o.offerPrice)}</span> : null}
                  </p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{OFFER_LABEL[o.status] || o.status}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {[
                    o.buyerAgent && `Agent: ${o.buyerAgent}`,
                    o.receivedOn && `Received ${formatDisplayDate(o.receivedOn)}`,
                    o.financing,
                    o.earnestMoney ? `Earnest ${money(o.earnestMoney)}` : '',
                    o.optionDays != null ? `${o.optionDays}-day option` : '',
                    o.closingDate ? `Closing ${formatDisplayDate(o.closingDate)}` : '',
                    o.sellerConcessions ? `Seller pays ${money(o.sellerConcessions)}` : '',
                    o.offerExpires ? `Expires ${o.offerExpires}` : '',
                    o.possession ? `Possession: ${o.possession}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {o.contingencies && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words">Contingencies: {o.contingencies}</p>}
                {o.terms && <p className="text-sm text-slate-400 mt-2 whitespace-pre-wrap break-words">{o.terms}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-1">Showings and feedback</h2>
          <p className="text-xs text-slate-500 mb-3">{showings.length} logged</p>
          {showings.length === 0 && <p className="text-sm text-slate-500">Nothing logged yet.</p>}
          <ul className="space-y-2">
            {showings.map((sh) => (
              <li key={sh.id} className="text-sm border border-slate-600 rounded-lg px-3 py-2">
                <p className="text-slate-200 break-words">
                  <span className="font-medium">{formatDisplayDate(sh.showing_date)}</span>
                  <span className="text-slate-500"> · {SHOWING_KIND_LABEL[sh.kind as keyof typeof SHOWING_KIND_LABEL] || 'Showing'}</span>
                  {sh.visitor ? <span className="text-slate-400"> · {sh.visitor}</span> : null}
                  {sh.interest ? <span className="text-slate-400"> · {SHOWING_INTEREST_LABEL[sh.interest]}</span> : null}
                </p>
                {sh.feedback && <p className="text-slate-400 mt-1 whitespace-pre-wrap break-words">{sh.feedback}</p>}
              </li>
            ))}
          </ul>
        </div>

        {priceChanges.length > 0 && (
          <div className={card}>
            <h2 className="text-lg font-bold text-slate-100 mb-3">Price history</h2>
            <ul className="text-sm space-y-1 text-slate-300">
              {priceChanges.map((pc) => (
                <li key={pc.id}>
                  <span className="text-slate-500">{formatDisplayDate(pc.changed_on)}</span> · {pc.old_price ? `${money(pc.old_price)} → ` : ''}
                  <span className="font-medium text-slate-100">{money(pc.new_price)}</span>
                  {pc.note ? <span className="text-slate-500"> — {pc.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ListingThread endpoint={`/api/agent/listings/${id}/comments`} self="agent" otherLabel={data.tcLabel} />
      </div>
    </div>
  );
}
