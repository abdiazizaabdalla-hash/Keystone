'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import AgentCalendarPrompt from '@/components/AgentCalendarPrompt';
import AgentTransactionList, { type AgentTransaction } from '@/components/AgentTransactionList';
import AgentListingCard, { type AgentListingSummary } from '@/components/AgentListingCard';
import type { ListingStatus } from '@/lib/listingsShared';

const SEEN_KEY = 'agent_seen_notices';
function readSeenHere(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeSeenHere(ids: string[]) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set(ids)].slice(-200)));
  } catch {
    // Not remembered on this device; the server flag still covers it.
  }
}

const LISTING_ORDER: ListingStatus[] = ['active', 'under_offer', 'preparing', 'converted', 'expired', 'withdrawn'];

interface PendingInvite {
  inviteId: string;
  transactionId: string;
  fileNumber: string;
  propertyAddress: string | null;
  tcLabel: string;
  createdAt: string;
}

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

  // "What's new": a deal that just reached this portal (most importantly a listing that became a transaction) is announced
  // once. It stays on screen for this visit, is marked as seen, and is gone the next time the dashboard opens.
  const [noticeIds, setNoticeIds] = useState<string[]>([]);
  const [hiddenNotices, setHiddenNotices] = useState<string[]>([]);
  const notices = transactions.filter((t) => noticeIds.includes(t.id) && !hiddenNotices.includes(t.id));


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

        // Announce what is new, then mark it seen (also remembered in this browser, for before the SQL update is run).
        const seenHere = readSeenHere();
        const fresh: string[] = (Array.isArray(txData) ? txData : []).filter((t: AgentTransaction) => t.isNew && !seenHere.includes(t.id)).map((t: AgentTransaction) => t.id);
        if (fresh.length > 0) {
          setNoticeIds((prev) => [...new Set([...prev, ...fresh])]);
          writeSeenHere([...seenHere, ...fresh]);
          authFetch('/api/agent/transactions/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: fresh }) }).catch(() => undefined);
        }

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-5 md:mb-8">
          <div className="flex items-center gap-3">
            <img src="/relay-icon.png" alt="Relay TC" className="hidden md:block w-10 h-10 object-contain" />
            <div>
              <h1 className="text-xl md:text-2xl font-display font-semibold text-slate-100">Dashboard</h1>
              <p className="text-slate-400 text-sm mt-0.5">{tcLabels.length === 1 ? `Your deals and listings with ${tcLabels[0]}.` : "Every deal you've been added to, and your listings."}</p>
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
            {notices.length > 0 && (
              <div className="mb-8 space-y-2">
                {notices.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 bg-emerald-900/20 border border-emerald-700/50 rounded-lg px-4 py-3">
                    <p className="text-sm text-slate-200 min-w-0 break-words">
                      {t.fromListingId ? (
                        <>
                          Your listing at <strong>{t.propertyAddress || t.fileNumber}</strong> is now an active transaction.
                        </>
                      ) : (
                        <>
                          You were added to <strong>{t.propertyAddress || t.fileNumber}</strong>.
                        </>
                      )}
                    </p>
                    <div className="flex items-center gap-3 shrink-0">
                      <Link href={`/agent/transactions/${t.id}`} className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">
                        Open the deal →
                      </Link>
                      <button type="button" onClick={() => setHiddenNotices((prev) => [...prev, t.id])} className="text-xs text-slate-500 hover:text-slate-300" aria-label="Dismiss">
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* At a glance. Each tile jumps to the section it counts. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
              {[
                { label: 'Active transactions', value: activeDeals, href: '#transactions', tone: 'text-blue-300' },
                { label: 'Overdue steps', value: overdueSteps, href: '#transactions', tone: overdueSteps > 0 ? 'text-red-400' : 'text-slate-100' },
                { label: 'Listings on the market', value: onMarket, href: '#listings', tone: 'text-emerald-300' },
                { label: 'Open offers', value: openOffers, href: '#listings', tone: openOffers > 0 ? 'text-amber-300' : 'text-slate-100' },
              ].map((t) => (
                <a key={t.label} href={t.href} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 hover:bg-slate-700/40 transition">
                  <p className={`text-2xl font-semibold ${t.tone}`}>{t.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t.label}</p>
                </a>
              ))}
            </div>

            {/* TRANSACTIONS */}
            <section id="transactions" className="mb-12 scroll-mt-6">
              <div className="flex items-baseline justify-between gap-3 mb-4 pb-2 border-b border-slate-700">
                <h2 className="text-lg font-display font-semibold text-slate-100">
                  Transactions <span className="text-sm font-normal text-slate-500">({transactions.length})</span>
                </h2>
                {transactions.length > 0 && (
                  <Link href="/agent/transactions" className="text-xs text-blue-400 hover:text-blue-300">
                    View all →
                  </Link>
                )}
              </div>
              {transactions.length === 0 ? (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
                  <p className="text-slate-400 text-sm">You aren&apos;t on any transactions yet.</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {pendingInvites.length > 0 ? 'Accept the invite above to get started.' : "Once a transaction coordinator adds you to one, it'll show up here."}
                  </p>
                </div>
              ) : (
                <AgentTransactionList transactions={transactions} multiTc={multiTc} />
              )}
            </section>
            {/* LISTINGS */}
            <section id="listings" className="scroll-mt-6">
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
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
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

          </>
        )}
      </div>
    </div>
  );
}
