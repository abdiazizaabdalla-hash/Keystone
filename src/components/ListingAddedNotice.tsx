'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import type { AgentListingSummary } from '@/components/AgentListingCard';

// "Your coordinator added you to a listing": announced once on the agent's dashboard, then marked seen (on the server, and in
// this browser for before add-listing-agent-notice.sql is run). Dismissing hides it for this visit.
const SEEN_KEY = 'agent_seen_listing_notices';
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

export default function ListingAddedNotice() {
  const [fresh, setFresh] = useState<AgentListingSummary[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/agent/listings')
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as AgentListingSummary[];
        const seenHere = readSeenHere();
        const isFresh = (Array.isArray(rows) ? rows : []).filter((l) => l.isNew && !seenHere.includes(l.id));
        if (cancelled || isFresh.length === 0) return;
        setFresh(isFresh);
        writeSeenHere([...seenHere, ...isFresh.map((l) => l.id)]);
        authFetch('/api/agent/listings/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: isFresh.map((l) => l.id) }) }).catch(() => undefined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = fresh.filter((l) => !hidden.includes(l.id));
  if (shown.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {shown.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 bg-emerald-900/20 border border-emerald-700/50 rounded-lg px-4 py-3">
          <p className="text-sm text-slate-200 min-w-0 break-words">
            {l.tcLabel} added you to the listing at <strong>{l.propertyAddress}</strong>.
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <Link href={`/agent/listings/${l.id}`} className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">
              Open the listing →
            </Link>
            <button type="button" onClick={() => setHidden((prev) => [...prev, l.id])} className="text-xs text-slate-500 hover:text-slate-300" aria-label="Dismiss">
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
