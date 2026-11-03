'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// The brokerage owner's "Agents" tab on the Collaborate page: invite agents and manage who has joined. Deals, listings and
// production live on the Transactions, Listings and Agents pages. Agents appear here only after they accept an invitation.

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
  baseCommission?: { type: 'percent' | 'flat_agent' | 'flat_brokerage'; value: number } | null;
}
interface Overview {
  agents: RosterRow[];
  totals: { agents: number; pending: number; activeDeals: number; overdueTasks: number; needsAttention: number; closedThisYear: number; volumeThisYear: number; closedLast30Days: number };
  terms: { sees: string[]; canDo: string[]; private: string[]; leave: string };
}
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function BrokerageOversight() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    const res = await authFetch('/api/oversight');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load your brokerage');
    setOverview(data);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      loadOverview().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your brokerage'));
    }, 0);
    return () => clearTimeout(t);
  }, [loadOverview]);

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
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not do that');
    }
  };

  if (!overview) return <p className="text-slate-400 text-sm">{error || 'Loading your agents…'}</p>;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

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
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Your agents</h2>
          <Link href="/dashboard/agents" className="text-sm text-blue-400 hover:text-blue-300">See deals, listings and commissions →</Link>
        </div>
        {overview.agents.length === 0 ? (
          <p className="text-sm text-slate-400">No one yet. Send an invitation above.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {overview.agents.map((a) => (
              <li key={a.linkId} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  {a.status === 'active' && a.userId ? <Link href={`/dashboard/collaborate/agents/${a.userId}`} className="text-slate-100 hover:text-blue-300">{a.name}</Link> : <p className="text-slate-100">{a.name}</p>}
                  <p className="text-xs text-slate-400">
                    {a.status === 'pending' ? `Invitation sent to ${a.email}. Nothing is shared until they accept.` : `${a.email} · Base commission: ${a.baseCommission ? (a.baseCommission.type === 'percent' ? `${a.baseCommission.value}%` : a.baseCommission.type === 'flat_agent' ? `$${a.baseCommission.value.toLocaleString()} flat to agent` : `$${a.baseCommission.value.toLocaleString()} brokerage fee`) : 'not set'}`}
                  </p>
                </div>
                {a.status === 'active' && a.needsAttention > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{a.needsAttention} need{a.needsAttention === 1 ? 's' : ''} attention</span>}
                {a.status === 'active' && a.userId && <Link href={`/dashboard/collaborate/agents/${a.userId}`} className="text-sm text-blue-400 hover:text-blue-300">Profile</Link>}
                <button type="button" onClick={() => remove(a)} className="text-sm text-slate-400 hover:text-red-300">{a.status === 'pending' ? 'Cancel invitation' : 'Remove'}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
