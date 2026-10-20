'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import AgentCalendarPrompt from '@/components/AgentCalendarPrompt';
import AgentListingCard, { type AgentListingSummary } from '@/components/AgentListingCard';
import type { ListingStatus } from '@/lib/listingsShared';

const LISTING_ORDER: ListingStatus[] = ['active', 'under_offer', 'preparing', 'converted', 'expired', 'withdrawn'];

interface AgentTransaction {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  status: string;
  tcUserId: string;
  tcLabel: string;
  nextDueDate: string | null;
  overdueCount: number;
}

interface PendingInvite {
  inviteId: string;
  transactionId: string;
  fileNumber: string;
  propertyAddress: string | null;
  tcLabel: string;
  createdAt: string;
}

// Same status colors as the TC's own transactions list, as a small pill.
function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Closed'
      ? 'bg-green-900/30 border-green-800 text-green-300'
      : status === 'Contract Pending'
        ? 'bg-yellow-900/20 border-yellow-800/70 text-yellow-300'
        : status === 'Under Contract'
          ? 'bg-blue-900/30 border-blue-800 text-blue-300'
          : 'bg-slate-700/60 border-slate-600 text-slate-300';
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${tone}`}>{status}</span>;
}

// Same due-date flag logic as the TC list -- overdue wins, Closed shows
// nothing, otherwise "Due today" / "Due in Nd" / a plain date.
const getDueBadge = (tx: AgentTransaction) => {
  if (tx.status === 'Closed') {
    return <span className="text-xs text-slate-600">—</span>;
  }
  if (tx.overdueCount > 0) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-900/30 border border-red-700 text-red-400 whitespace-nowrap">
        {tx.overdueCount} overdue
      </span>
    );
  }
  if (!tx.nextDueDate) {
    return <span className="text-xs text-slate-600">—</span>;
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (tx.nextDueDate === todayStr) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/30 border border-amber-700 text-amber-400 whitespace-nowrap">
        Due today
      </span>
    );
  }
  const daysDiff = Math.round(
    (new Date(`${tx.nextDueDate}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (daysDiff > 0 && daysDiff <= 3) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/10 border border-amber-800/60 text-amber-300 whitespace-nowrap">
        Due in {daysDiff}d
      </span>
    );
  }
  return <span className="text-xs text-slate-500 whitespace-nowrap">Due {formatDisplayDate(tx.nextDueDate)}</span>;
};

// The whole point of one login across every TC that's added this agent:
// this list is the union of every transaction_agents row for them,
// regardless of which TC/brokerage it came from (see
// GET /api/agent/transactions). Grouped by TC below since most agents
// only ever work with one, but some work several deals across a few.
export default function AgentHubPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<AgentTransaction[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [listings, setListings] = useState<AgentListingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState('');
  // Bumped after a successful accept to re-run the effect below and pull
  // the just-accepted transaction into the list -- same
  // define-load-inside-the-effect shape every other page in this app
  // uses, just re-triggerable without needing setState calls routed
  // through a useCallback dependency.
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [txRes, invitesRes, listingsRes] = await Promise.all([
          authFetch('/api/agent/transactions'),
          authFetch('/api/agent/invites'),
          authFetch('/api/agent/listings').catch(() => null),
        ]);
        if (!txRes.ok) throw new Error('Failed to load your transactions');
        const txData = await txRes.json();
        setTransactions(Array.isArray(txData) ? txData : []);

        // Listings shared by the TC (read-only). Non-fatal like the invites.
        if (listingsRes && listingsRes.ok) {
          const l = await listingsRes.json();
          setListings(Array.isArray(l) ? l : []);
        }

        // Non-fatal if this one fails -- the transactions list is the
        // part that matters most, and an agent can still open a deal
        // they've already accepted even if pending invites fail to load.
        if (invitesRes.ok) {
          const inviteData = await invitesRes.json();
          setPendingInvites(Array.isArray(inviteData) ? inviteData : []);
        }
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        console.error('Error loading agent transactions:', err);
        setError('Could not load your transactions. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router, reloadCount]);

  // Explicit accept from the dashboard -- the only way access is granted
  // now that signing in (via an invite's link or a plain /agent/login)
  // no longer auto-accepts anything (see src/app/agent/accept/page.tsx).
  const handleAccept = async (transactionId: string) => {
    setAcceptError('');
    setAccepting(transactionId);
    try {
      const res = await authFetch('/api/agent-invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not accept this invite');
      }
      setReloadCount((c) => c + 1);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      console.error('Error accepting invite:', err);
      setAcceptError(err instanceof Error ? err.message : 'Could not accept this invite. Please try again.');
    } finally {
      setAccepting(null);
    }
  };

  const onMarket = listings.filter((l) => l.status === 'active' || l.status === 'under_offer').length;
  const openOffers = listings.reduce((n, l) => n + l.openOffers, 0);
  const activeDeals = transactions.filter((t) => t.status !== 'Closed').length;
  const overdueSteps = transactions.filter((t) => t.status !== 'Closed').reduce((n, t) => n + t.overdueCount, 0);

  // Most agents work with one coordinator, so it is only named per row when there are several.
  const tcLabels = useMemo(() => [...new Set([...transactions.map((t) => t.tcLabel), ...listings.map((l) => l.tcLabel)].filter(Boolean))], [transactions, listings]);
  const multiTc = tcLabels.length > 1;

  // Needs attention first (overdue, then soonest due), closed deals last.
  const sortedTransactions = useMemo(() => {
    const rank = (t: AgentTransaction) => (t.status === 'Closed' ? 3 : t.overdueCount > 0 ? 0 : t.nextDueDate ? 1 : 2);
    return [...transactions].sort(
      (x, y) => rank(x) - rank(y) || (x.nextDueDate || '9999').localeCompare(y.nextDueDate || '9999') || (x.propertyAddress || '').localeCompare(y.propertyAddress || '')
    );
  }, [transactions]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-5 md:mb-8">
          <div className="flex items-center gap-3">
            <img src="/relay-icon.png" alt="Relay TC" className="hidden md:block w-10 h-10 object-contain" />
            <div>
              <h1 className="text-xl md:text-2xl font-display font-semibold text-slate-100">Dashboard</h1>
              <p className="text-slate-400 text-sm mt-0.5">{tcLabels.length === 1 ? `Your listings and deals with ${tcLabels[0]}.` : "Your listings and every deal you've been added to."}</p>
            </div>
          </div>
        </div>

        <AgentCalendarPrompt />

        {pendingInvites.length > 0 && (
          <div className="mb-8">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Pending invite{pendingInvites.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.inviteId}
                  className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-br from-amber-900/20 to-slate-800 border border-amber-700/50 rounded-lg px-5 py-4"
                >
                  <div className="min-w-0 break-words">
                    <p className="text-slate-100 text-sm font-semibold">
                      {invite.propertyAddress || invite.fileNumber}
                    </p>
                    <p className="text-slate-400 text-xs mt-0.5">{invite.tcLabel} added you to this deal</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAccept(invite.transactionId)}
                    disabled={accepting === invite.transactionId}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 shrink-0 w-full sm:w-auto"
                  >
                    {accepting === invite.transactionId ? 'Accepting…' : 'Accept'}
                  </button>
                </div>
              ))}
            </div>
            {acceptError && <p className="text-red-400 text-sm mt-2">{acceptError}</p>}
          </div>
        )}

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : (
          <>
            {/* At a glance. Each tile jumps to the section it counts. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
              {[
                { label: 'Listings on the market', value: onMarket, href: '#listings', tone: 'text-emerald-300' },
                { label: 'Open offers', value: openOffers, href: '#listings', tone: openOffers > 0 ? 'text-amber-300' : 'text-slate-100' },
                { label: 'Active transactions', value: activeDeals, href: '#transactions', tone: 'text-blue-300' },
                { label: 'Overdue steps', value: overdueSteps, href: '#transactions', tone: overdueSteps > 0 ? 'text-red-400' : 'text-slate-100' },
              ].map((t) => (
                <a key={t.label} href={t.href} className="bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 hover:bg-slate-700/40 transition">
                  <p className={`text-2xl font-semibold ${t.tone}`}>{t.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t.label}</p>
                </a>
              ))}
            </div>

            {/* LISTINGS */}
            <section id="listings" className="mb-12 scroll-mt-6">
              <div className="flex items-baseline justify-between gap-3 mb-4 pb-2 border-b border-slate-700">
                <h2 className="text-lg font-display font-semibold text-slate-100">
                  Listings <span className="text-sm font-normal text-slate-500">({listings.length})</span>
                </h2>
                {listings.length > 0 && (
                  <Link href="/agent/listings" className="text-xs text-blue-400 hover:text-blue-300">
                    View all →
                  </Link>
                )}
              </div>
              {listings.length === 0 ? (
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                  <p className="text-slate-400 text-sm">No listings shared with you yet.</p>
                  <p className="text-slate-500 text-xs mt-1">When your TC starts a listing for you and shares it, it shows up here.</p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {[...listings]
                    .filter((l) => l.status !== 'expired')
                    .sort((x, y) => LISTING_ORDER.indexOf(x.status) - LISTING_ORDER.indexOf(y.status))
                    .slice(0, 6)
                    .map((l) => (
                      <AgentListingCard key={l.id} listing={l} />
                    ))}
                </div>
              )}
            </section>

            {/* TRANSACTIONS */}
            <section id="transactions" className="scroll-mt-6">
              <div className="flex items-baseline justify-between gap-3 mb-4 pb-2 border-b border-slate-700">
                <h2 className="text-lg font-display font-semibold text-slate-100">
                  Transactions <span className="text-sm font-normal text-slate-500">({transactions.length})</span>
                </h2>
              </div>
              {transactions.length === 0 ? (
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                  <p className="text-slate-400 text-sm">You aren&apos;t on any transactions yet.</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {pendingInvites.length > 0 ? 'Accept the invite above to get started.' : "Once a transaction coordinator adds you to one, it'll show up here."}
                  </p>
                </div>
              ) : (
                <>
                  {/* Phones: one card per deal */}
                  <div className="md:hidden space-y-3">
                    {sortedTransactions.map((tx) => (
                      <Link
                        key={tx.id}
                        href={`/agent/transactions/${tx.id}`}
                        className="block bg-slate-800/50 border border-slate-700 rounded-lg p-4 active:bg-slate-700/40 transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-slate-100 font-semibold leading-snug break-words">{tx.propertyAddress || tx.fileNumber}</p>
                          <StatusPill status={tx.status} />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mt-3">
                          <span className="font-mono text-xs text-slate-500">File {tx.fileNumber}</span>
                          <span>{getDueBadge(tx)}</span>
                        </div>
                        {multiTc && <p className="text-xs text-slate-500 mt-2">{tx.tcLabel}</p>}
                      </Link>
                    ))}
                  </div>

                  {/* Tablets and desktop: one clean table */}
                  <div className="hidden md:block bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-700 text-left">
                          <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</th>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">File #</th>
                          {multiTc && <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Coordinator</th>}
                          <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Next due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedTransactions.map((tx) => (
                          <tr
                            key={tx.id}
                            className="border-b border-slate-700/60 last:border-0 hover:bg-slate-700/30 cursor-pointer transition"
                            onClick={() => router.push(`/agent/transactions/${tx.id}`)}
                          >
                            <td className="px-5 py-3.5">
                              <span className="text-slate-100 font-medium block max-w-md truncate">{tx.propertyAddress || tx.fileNumber}</span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="font-mono text-sm text-slate-400">{tx.fileNumber}</span>
                            </td>
                            {multiTc && (
                              <td className="px-5 py-3.5">
                                <span className="text-sm text-slate-300">{tx.tcLabel}</span>
                              </td>
                            )}
                            <td className="px-5 py-3.5">
                              <StatusPill status={tx.status} />
                            </td>
                            <td className="px-5 py-3.5">{getDueBadge(tx)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
