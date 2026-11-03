'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { Avatar } from './chat/ChatBubbles';

// The brokerage owner's Agents page: one card per agent who joined, a quick snapshot (deals, listings, what is current,
// latest commission statements, base commission) with links to the full profile and to message them.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Snap {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  joinedAt: string | null;
  baseCommission: { type: SplitType; value: number } | null;
  openDeals: number;
  pipelineVolume: number;
  closedThisYear: number;
  volumeThisYear: number;
  openListings: number;
  needsAttention: number;
  currentDeals: { id: string; address: string | null; status: string | null; closingDate: string | null; flags: string[]; nextStep: { name: string; dueDate: string | null } | null }[];
  currentListings: { id: string; address: string | null; status: string | null; listPrice: number | string | null; flags: string[] }[];
  recentCommissions: { id: string; transactionId: string; statementNumber: string; property: string | null; agentNet: number; status: string; submitted?: boolean; paidOn: string | null }[];
  unpaidAgentCents: number;
}
interface Pending { linkId: string; email: string; invitedAt: string }

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const compact = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`);
const fmt = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const base = (b: Snap['baseCommission']) => (b ? (b.type === 'percent' ? `Agent keeps ${b.value}%` : b.type === 'flat_agent' ? `Agent gets ${money(b.value)} flat` : `Brokerage fee ${money(b.value)}`) : 'Base commission not set');
const STATUS: Record<string, string> = { proposed: 'Waiting for agent', change_requested: 'Change requested', accepted: 'Agreed', paid: 'Paid' };
const STATUS_CLS: Record<string, string> = { proposed: 'text-slate-300', change_requested: 'text-red-300', accepted: 'text-blue-300', paid: 'text-emerald-300' };

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className={`text-lg font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

export default function AgentSnapshotCards() {
  const [agents, setAgents] = useState<Snap[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/oversight/roster');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load your agents');
        setAgents(json.agents ?? []);
        setPending(json.pending ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your agents');
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (error) return <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>;
  if (!agents) return <p className="text-sm text-slate-400">Loading your agents…</p>;

  const needle = q.trim().toLowerCase();
  const visible = needle ? agents.filter((a) => `${a.name} ${a.email ?? ''}`.toLowerCase().includes(needle)) : agents;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your agents" aria-label="Search your agents" className="flex-1 min-w-[12rem] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
        <Link href="/dashboard/collaborate#agents" className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition whitespace-nowrap">+ Invite an agent</Link>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white/5 border border-dashed border-white/20 rounded-2xl p-10 text-center">
          <p className="text-slate-200 font-semibold mb-1">{pending.length > 0 ? 'Waiting for your agents to accept' : 'No agents have joined yet'}</p>
          <p className="text-sm text-slate-400 mb-4">Agents with their own Relay workspace join by invitation. Their deals, listings, commissions and profile show up here as soon as they do.</p>
          <Link href="/dashboard/collaborate#agents" className="inline-block px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition">{pending.length > 0 ? 'See invitations' : 'Invite an agent'}</Link>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-400">No agent matches “{q.trim()}”.</p>
      ) : (
        <div className="grid xl:grid-cols-2 gap-4">
          {visible.map((a) => (
            <section key={a.id} aria-label={a.name} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col">
              <div className="flex items-start gap-3">
                <Avatar name={a.name} id={a.id} size="lg" />
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/collaborate/agents/${a.id}`} className="text-base font-semibold text-slate-100 hover:text-blue-300 break-words">{a.name}</Link>
                  <p className="text-xs text-slate-400 break-words">{[a.email, a.phone].filter(Boolean).join(' · ') || 'No contact details yet'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{a.joinedAt ? `Joined ${fmt(a.joinedAt)} · ` : ''}{base(a.baseCommission)}</p>
                </div>
                {a.needsAttention > 0 && <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{a.needsAttention} need{a.needsAttention === 1 ? 's' : ''} attention</span>}
              </div>

              <div className="grid grid-cols-4 gap-3 mt-4 pb-4 border-b border-white/10">
                <Stat label="Open deals" value={a.openDeals} />
                <Stat label="Listings" value={a.openListings} />
                <Stat label="Closed this year" value={a.closedThisYear} tone="text-emerald-300" />
                <Stat label="Owed to agent" value={money(a.unpaidAgentCents / 100)} />
              </div>

              <div className="mt-4 grid sm:grid-cols-2 gap-4 flex-1">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Current transactions · {compact(a.pipelineVolume)}</p>
                  {a.currentDeals.length === 0 ? <p className="text-xs text-slate-500">No open deals.</p> : (
                    <ul className="space-y-1.5">
                      {a.currentDeals.map((d) => (
                        <li key={d.id}>
                          <Link href={`/dashboard/collaborate/deals/${d.id}`} className="block text-xs hover:bg-white/5 rounded px-1 -mx-1 py-0.5">
                            <span className="block text-slate-100 truncate">{d.address || 'Untitled deal'}</span>
                            <span className="block text-slate-400 truncate">{d.status}{d.closingDate ? ` · closes ${fmt(d.closingDate)}` : ''}{d.flags.length > 0 ? <span className="text-amber-300"> · needs attention</span> : null}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mt-3 mb-1.5">Current listings</p>
                  {a.currentListings.length === 0 ? <p className="text-xs text-slate-500">No open listings.</p> : (
                    <ul className="space-y-1.5">
                      {a.currentListings.map((l) => (
                        <li key={l.id}>
                          <Link href={`/dashboard/collaborate/listings/${l.id}`} className="block text-xs hover:bg-white/5 rounded px-1 -mx-1 py-0.5">
                            <span className="block text-slate-100 truncate">{l.address || 'Untitled listing'}</span>
                            <span className="block text-slate-400 truncate">{String(l.status ?? '').replace('_', ' ')}{Number(l.listPrice) > 0 ? ` · ${money(Number(l.listPrice))}` : ''}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Recent commission invoices</p>
                  {a.recentCommissions.length === 0 ? <p className="text-xs text-slate-500">None yet. They appear when an agent generates one, or when you propose a split on one of their deals.</p> : (
                    <ul className="space-y-1.5">
                      {a.recentCommissions.map((c) => (
                        <li key={c.id} className="text-xs flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-slate-100 truncate">{c.property || c.statementNumber}</span>
                            <span className={`block ${c.submitted ? 'text-amber-300' : STATUS_CLS[c.status] ?? 'text-slate-400'}`}>{c.submitted ? 'Needs your approval' : STATUS[c.status] ?? c.status}{c.paidOn ? ` ${fmt(c.paidOn)}` : ''}</span>
                          </span>
                          <span className="shrink-0 text-emerald-300">{money(c.agentNet)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-4 text-sm">
                <Link href={`/dashboard/collaborate/agents/${a.id}`} className="text-blue-400 hover:text-blue-300 font-medium">Full profile</Link>
                <Link href={`/dashboard/collaborate?with=${a.id}#messages`} className="text-slate-300 hover:text-slate-100">Message</Link>
                <Link href="/dashboard/invoices" className="text-slate-300 hover:text-slate-100">Invoices</Link>
              </div>
            </section>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-100 mb-1">Invitations waiting ({pending.length})</p>
          <p className="text-xs text-slate-400">{pending.map((p) => p.email).join(', ')}</p>
        </div>
      )}
    </div>
  );
}
