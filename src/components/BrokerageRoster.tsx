'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { Avatar } from './chat/ChatBubbles';

// The broker's live roster (Collaborate → Agents): one row per agent with what the broker checks first thing in the
// morning (open deals, what is late, closing this week, last activity). A row opens that agent's profile, which lists
// their deals and listings. Inviting and cancelling invitations happens here too.

interface Row {
  id: string;
  linkId: string;
  name: string;
  email: string | null;
  openDeals: number;
  lateTasks: number;
  lateDeals: number;
  closingThisWeek: number;
  lastActivity: string | null;
  openListings: number;
}
interface Pending {
  linkId: string;
  email: string;
  invitedAt: string;
}
interface Terms {
  sees: string[];
  canDo: string[];
  private: string[];
  leave: string;
}

/** "today", "yesterday", "3 days ago", or a short date for older activity. */
export function lastActiveLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'No activity yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'No activity yet';
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Cell({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="min-w-[4.5rem]">
      <p className={`text-base font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

export default function BrokerageRoster() {
  const [agents, setAgents] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await authFetch('/api/oversight/roster');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Could not load your agents');
    setAgents(json.agents ?? []);
    setPending(json.pending ?? []);
    setTerms(json.terms ?? null);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your agents'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await authFetch('/api/oversight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send the invitation');
      setMessage(`Invitation sent to ${email}. They see what you can see before they accept.`);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p: Pending) => {
    if (!window.confirm(`Cancel the invitation to ${p.email}?`)) return;
    setError('');
    try {
      const res = await authFetch(`/api/oversight/${p.linkId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not cancel that invitation');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel that invitation');
    }
  };

  if (error && !agents) return <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>;
  if (!agents) return <p className="text-sm text-slate-400">Loading your agents…</p>;

  const needle = q.trim().toLowerCase();
  const visible = (needle ? agents.filter((a) => `${a.name} ${a.email ?? ''}`.toLowerCase().includes(needle)) : agents)
    .slice()
    .sort((a, b) => b.lateTasks - a.lateTasks || b.closingThisWeek - a.closingThisWeek || a.name.localeCompare(b.name));
  const totals = agents.reduce((t, a) => ({ open: t.open + a.openDeals, late: t.late + a.lateTasks, week: t.week + a.closingThisWeek }), { open: 0, late: 0, week: 0 });

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Agents', value: agents.length, tone: '' },
          { label: 'Open deals', value: totals.open, tone: '' },
          { label: 'Late items', value: totals.late, tone: totals.late > 0 ? 'text-amber-300' : '' },
          { label: 'Closing this week', value: totals.week, tone: totals.week > 0 ? 'text-emerald-300' : '' },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{s.label}</p>
            <p className={`text-2xl font-semibold mt-0.5 ${s.tone || 'text-slate-100'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your agents" aria-label="Search your agents" className="flex-1 min-w-[12rem] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
        <button type="button" onClick={() => setInviting((v) => !v)} aria-expanded={inviting} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition whitespace-nowrap">
          {inviting ? 'Close' : '+ Invite an agent'}
        </button>
      </div>

      {inviting && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm text-slate-400 mb-3 max-w-2xl">The agent needs their own Relay workspace. They get an invitation and choose whether to join. Until they accept, you see nothing of theirs.</p>
          <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2 max-w-xl">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agent@example.com" aria-label="Agent email" className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500" />
            <button disabled={busy || !email} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </form>
          {message && <p className="text-sm text-emerald-300 mt-2">{message}</p>}
          {terms && (
            <details className="mt-3 text-sm text-slate-400">
              <summary className="cursor-pointer text-slate-300">What the agent agrees to</summary>
              <ul className="list-disc ml-5 mt-2 space-y-1">
                {[...terms.sees, ...terms.canDo, ...terms.private].map((line) => (
                  <li key={line}>{line}</li>
                ))}
                <li>{terms.leave}</li>
              </ul>
            </details>
          )}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="bg-white/5 border border-dashed border-white/20 rounded-2xl p-10 text-center">
          <p className="text-slate-200 font-semibold mb-1">{pending.length > 0 ? 'Waiting for your agents to accept' : 'No agents have joined yet'}</p>
          <p className="text-sm text-slate-400">Their deals, listings and activity show up here as soon as they join.</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-400">No agent matches “{q.trim()}”.</p>
      ) : (
        <ul className="bg-white/5 border border-white/10 rounded-2xl divide-y divide-white/5" aria-label="Agents">
          {visible.map((a) => (
            <li key={a.id}>
              <Link href={`/dashboard/collaborate/agents/${a.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 hover:bg-white/5 transition">
                <div className="flex items-center gap-3 min-w-[12rem] flex-1">
                  <Avatar name={a.name} id={a.id} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">{a.name}</p>
                    <p className="text-xs text-slate-500 truncate">{a.email ?? ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <Cell label="Open deals" value={a.openDeals} />
                  <Cell label="Late" value={a.lateTasks} tone={a.lateTasks > 0 ? 'text-amber-300' : 'text-slate-500'} />
                  <Cell label="Closing this week" value={a.closingThisWeek} tone={a.closingThisWeek > 0 ? 'text-emerald-300' : 'text-slate-500'} />
                  <div className="min-w-[6rem]">
                    <p className="text-sm text-slate-200">{lastActiveLabel(a.lastActivity)}</p>
                    <p className="text-[11px] text-slate-500">Last activity</p>
                  </div>
                </div>
                <span className="text-sm text-blue-400" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-100 mb-2">Invitations waiting ({pending.length})</p>
          <ul className="space-y-1">
            {pending.map((p) => (
              <li key={p.linkId} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-300 truncate">{p.email}</span>
                <button type="button" onClick={() => cancel(p)} className="text-slate-400 hover:text-red-300 shrink-0">Cancel</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
