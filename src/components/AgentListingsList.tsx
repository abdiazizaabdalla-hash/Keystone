'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import AgentListingRows, { type AgentListing } from './AgentListingRows';

// The brokerage owner's Listings view: every listing of every agent who joined, read-only, with the next step on each.

export default function AgentListingsList() {
  const [listings, setListings] = useState<AgentListing[] | null>(null);
  const [error, setError] = useState('');
  const [agent, setAgent] = useState('');
  const [show, setShow] = useState<'open' | 'attention' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/oversight/listings?show=all');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load the listings');
        setListings(json as AgentListing[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the listings');
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const agents = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of listings ?? []) if (l.agent) m.set(l.agent.id, l.agent.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [listings]);

  if (error) return <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>;
  if (!listings) return <p className="text-sm text-slate-400">Loading…</p>;

  const isOpen = (l: AgentListing) => l.status === 'preparing' || l.status === 'active' || l.status === 'under_offer';
  const needle = q.trim().toLowerCase();
  const visible = listings
    .filter((l) => (agent ? l.agent?.id === agent : true))
    .filter((l) => (show === 'all' ? true : show === 'closed' ? !isOpen(l) : isOpen(l)))
    .filter((l) => (show === 'attention' ? l.health.flags.length > 0 : true))
    .filter((l) => (needle ? `${l.property_address ?? ''} ${l.mls_number ?? ''} ${l.agent?.name ?? ''} ${l.nextStep?.name ?? ''}`.toLowerCase().includes(needle) : true));
  const open = listings.filter(isOpen);
  const attention = open.filter((l) => l.health.flags.length > 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm" role="tablist" aria-label="Show agents’ listings">
          {([['open', `Open (${open.length})`], ['attention', `Needs attention (${attention.length})`], ['closed', 'Closed'], ['all', 'All']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={show === id} onClick={() => setShow(id)} className={`px-3 py-1.5 rounded-full border transition ${show === id ? 'border-blue-500 text-blue-300 bg-blue-900/20' : id === 'attention' ? 'border-red-500/40 text-red-300 hover:text-red-200' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filter by agent" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200">
          <option value="">All agents</option>
          {agents.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent, address, MLS or next step" aria-label="Search agents’ listings" className="flex-1 min-w-[12rem] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
      </div>
      {listings.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-300">Listings show up here once an agent joins your brokerage and adds one.</div>
      ) : visible.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-300">Nothing matches.</div>
      ) : (
        <AgentListingRows listings={visible} />
      )}
      <p className="text-xs text-slate-500 mt-3">Opening a listing shows its checklist, dates and document names. Seller details and offers stay with the agent.</p>
    </div>
  );
}
