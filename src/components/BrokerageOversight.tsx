'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// The brokerage owner's "Agents" tab on the Collaborate page: invite agents, see production and what needs attention,
// and open any of their deals. Agents appear here only after they accept an invitation and agree to this oversight.

interface Production {
  closedThisYear: number;
  volumeThisYear: number;
  closedLast30Days: number;
  activeDeals: number;
  pipelineVolume: number;
}
interface RosterRow {
  linkId: string;
  status: 'pending' | 'active';
  email: string;
  name: string;
  userId: string | null;
  invitedAt: string;
  joinedAt: string | null;
  production: Production;
  overdueTasks: number;
  needsAttention: number;
}
interface Overview {
  agents: RosterRow[];
  totals: { agents: number; pending: number; activeDeals: number; overdueTasks: number; needsAttention: number; closedThisYear: number; volumeThisYear: number; closedLast30Days: number };
  terms: { sees: string[]; canDo: string[]; private: string[]; leave: string };
}
interface DealRow {
  id: string;
  property_address: string | null;
  file_number: string | null;
  status: string | null;
  closing_date: string | null;
  purchase_price: number | string | null;
  agent: { id: string; name: string };
  health: { openTasks: number; overdueTasks: number; nextDue: string | null; flags: string[] };
}

const FLAG_LABEL: Record<string, string> = { overdue: 'Overdue steps', closing_soon: 'Closing soon, steps open', no_closing_date: 'No closing date' };
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function BrokerageOversight() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [show, setShow] = useState<'open' | 'closed'>('open');

  const loadOverview = useCallback(async () => {
    const res = await authFetch('/api/oversight');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load your brokerage');
    setOverview(data);
  }, []);

  const loadDeals = useCallback(async () => {
    const qs = new URLSearchParams({ show });
    if (agentFilter) qs.set('agent', agentFilter);
    const res = await authFetch(`/api/oversight/deals?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the deals');
    setDeals(Array.isArray(data) ? data : []);
  }, [show, agentFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadOverview().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your brokerage'));
    }, 0);
    return () => clearTimeout(t);
  }, [loadOverview]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadDeals().catch((e) => setError(e instanceof Error ? e.message : 'Could not load the deals'));
    }, 0);
    return () => clearTimeout(t);
  }, [loadDeals]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await authFetch('/api/oversight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send the invitation');
      setMessage(`Invitation sent to ${email}. They will see what you can see before they accept.`);
      setEmail('');
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: RosterRow) => {
    const what = row.status === 'pending' ? `Cancel the invitation to ${row.email}?` : `Remove ${row.name} from your brokerage? They keep all of their deals.`;
    if (!window.confirm(what)) return;
    setError('');
    try {
      const res = await authFetch(`/api/oversight/${row.linkId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not do that');
      if (agentFilter === row.userId) setAgentFilter('');
      await Promise.all([loadOverview(), loadDeals()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not do that');
    }
  };

  if (!overview) return <p className="text-slate-400 text-sm">{error || 'Loading your agents…'}</p>;
  const t = overview.totals;
  const tiles: [string, string][] = [
    ['Agents', String(t.agents)],
    ['Active deals', String(t.activeDeals)],
    ['Need attention', String(t.needsAttention)],
    ['Overdue steps', String(t.overdueTasks)],
    ['Closed this year', String(t.closedThisYear)],
    ['Volume this year', money(t.volumeThisYear)],
  ];
  const active = overview.agents.filter((a) => a.status === 'active');

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {tiles.map(([label, value]) => (
          <div key={label} className={card}>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-xl font-semibold text-slate-100 mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Add an agent</h2>
        <p className="text-sm text-slate-400 mb-3 max-w-2xl">
          The agent needs their own Relay workspace. They get an invitation and choose whether to join. Until they accept, you see nothing of theirs.
        </p>
        <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2 max-w-xl">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="agent@example.com"
            aria-label="Agent email"
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button disabled={busy || !email} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
        {message && <p className="text-sm text-emerald-300 mt-2">{message}</p>}
        <details className="mt-3 text-sm text-slate-400">
          <summary className="cursor-pointer text-slate-300">What the agent agrees to</summary>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            {[...overview.terms.sees, ...overview.terms.canDo, ...overview.terms.private].map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>{overview.terms.leave}</li>
          </ul>
        </details>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-3">Your agents</h2>
        {overview.agents.length === 0 ? (
          <p className="text-sm text-slate-400">No one yet. Send an invitation above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-2 pr-3 font-medium">Agent</th>
                  <th className="py-2 pr-3 font-medium">Active</th>
                  <th className="py-2 pr-3 font-medium">Need attention</th>
                  <th className="py-2 pr-3 font-medium">Closed (30 days)</th>
                  <th className="py-2 pr-3 font-medium">Closed (year)</th>
                  <th className="py-2 pr-3 font-medium">Volume (year)</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {overview.agents.map((a) => (
                  <tr key={a.linkId} className="border-t border-white/5">
                    <td className="py-2 pr-3">
                      <p className="text-slate-100">{a.name}</p>
                      {a.status === 'pending' ? <p className="text-xs text-amber-300">Invitation pending · {a.email}</p> : <p className="text-xs text-slate-500">{a.email}</p>}
                    </td>
                    {a.status === 'active' ? (
                      <>
                        <td className="py-2 pr-3 text-slate-200">{a.production.activeDeals}</td>
                        <td className={`py-2 pr-3 ${a.needsAttention ? 'text-amber-300' : 'text-slate-200'}`}>{a.needsAttention}</td>
                        <td className="py-2 pr-3 text-slate-200">{a.production.closedLast30Days}</td>
                        <td className="py-2 pr-3 text-slate-200">{a.production.closedThisYear}</td>
                        <td className="py-2 pr-3 text-slate-200">{money(a.production.volumeThisYear)}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-2 pr-3 text-xs text-slate-500">Nothing is shared until they accept.</td>
                    )}
                    <td className="py-2 text-right whitespace-nowrap">
                      {a.status === 'active' && (
                        <button type="button" onClick={() => setAgentFilter(agentFilter === a.userId ? '' : (a.userId ?? ''))} className="text-xs text-blue-400 hover:text-blue-300 mr-3">
                          {agentFilter === a.userId ? 'Show all' : 'Their deals'}
                        </button>
                      )}
                      <button type="button" onClick={() => remove(a)} className="text-xs text-slate-400 hover:text-red-300">
                        {a.status === 'pending' ? 'Cancel' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-slate-100 mr-auto">Deals</h2>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            aria-label="Filter by agent"
            className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-200"
          >
            <option value="">All agents</option>
            {active.map((a) => (
              <option key={a.linkId} value={a.userId ?? ''}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm">
            {(['open', 'closed'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setShow(s)} className={`px-3 py-1.5 ${show === s ? 'bg-blue-500/20 text-blue-200' : 'text-slate-400 hover:text-slate-200'}`}>
                {s === 'open' ? 'Open' : 'Closed'}
              </button>
            ))}
          </div>
        </div>
        {deals.length === 0 ? (
          <p className="text-sm text-slate-400">{t.agents === 0 ? 'Deals show up here once an agent joins.' : `No ${show} deals.`}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {deals.map((d) => (
              <li key={d.id}>
                <Link href={`/dashboard/collaborate/deals/${d.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-white/5 -mx-2 px-2 rounded-lg transition">
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-100 truncate">{d.property_address || d.file_number || 'Untitled deal'}</p>
                    <p className="text-xs text-slate-400">
                      {d.agent.name} · {d.status}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.health.flags.map((f) => (
                      <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                        {FLAG_LABEL[f] ?? f}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400 text-right w-28">
                    <p>Closing {fmtDate(d.closing_date)}</p>
                    {d.status !== 'Closed' && <p>{d.health.openTasks} open steps</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
