'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import AgentDealRows, { type AgentDeal } from './AgentDealRows';

// The brokerage owner's Transactions view: every deal of every agent who joined, read-only, with the next step on each.

export default function AgentDealsList() {
  const [deals, setDeals] = useState<AgentDeal[] | null>(null);
  const [error, setError] = useState('');
  const [agent, setAgent] = useState('');
  const [show, setShow] = useState<'open' | 'attention' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/oversight/deals?show=all');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load the deals');
        setDeals(json as AgentDeal[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the deals');
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const agents = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals ?? []) {
      const a = d.agent;
      if (a) m.set(a.id, a.name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [deals]);

  if (error) return <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>;
  if (!deals) return <p className="text-sm text-slate-400">Loading…</p>;

  const needle = q.trim().toLowerCase();
  const visible = deals
    .filter((d) => (agent ? d.agent?.id === agent : true))
    .filter((d) => (show === 'all' ? true : show === 'closed' ? d.status === 'Closed' : d.status !== 'Closed'))
    .filter((d) => (show === 'attention' ? d.health.flags.length > 0 : true))
    .filter((d) => (needle ? `${d.property_address ?? ''} ${d.file_number ?? ''} ${d.agent?.name ?? ''} ${d.nextStep?.name ?? ''}`.toLowerCase().includes(needle) : true));
  const open = deals.filter((d) => d.status !== 'Closed');
  const attention = open.filter((d) => d.health.flags.length > 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm" role="tablist" aria-label="Show agents’ transactions">
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
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent, address, file or next step" aria-label="Search agents’ transactions" className="flex-1 min-w-[12rem] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
      </div>
      {deals.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-300">Deals show up here once an agent joins your brokerage.</div>
      ) : visible.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-300">Nothing matches.</div>
      ) : (
        <AgentDealRows deals={visible} />
      )}
      <p className="text-xs text-slate-500 mt-3">Opening a deal shows its checklist, dates and document names.</p>
    </div>
  );
}
