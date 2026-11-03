'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// The brokerage owner's dashboard: their agents, the pipeline, what needs attention, closings coming up and where
// commissions stand. Shown instead of the empty dashboard when the owner has no deals of their own, and as a summary
// above their own dashboard when they do (compact). Only ever rendered for a brokerage owner.

interface Item { id: string; address: string | null; status: string | null; agent: { id: string; name: string }; closingDate?: string | null; flags: string[]; nextStep: { name: string; dueDate: string | null } | null }
interface Home {
  totals: { agents: number; pendingInvites: number; openDeals: number; pipelineVolume: number; openListings: number; listPriceVolume: number; closedThisYear: number; volumeThisYear: number; closedLast30Days: number; needsAttention: number };
  attentionDeals: Item[];
  attentionListings: Item[];
  closingSoon: Item[];
  commissions: { changeRequested: number; awaitingAgent: number; readyToPay: number; unpaidCount: number; unpaidAgentCents: number; closedWithoutStatement: number };
  unreadMessages: number;
  agents: { id: string; name: string; openDeals: number; openListings: number; needsAttention: number; closedThisYear: number; baseCommission: { type: 'percent' | 'flat_agent' | 'flat_brokerage'; value: number } | null }[];
}

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const short = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`);
const fmt = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const base = (b: Home['agents'][number]['baseCommission']) => (b ? (b.type === 'percent' ? `${b.value}%` : b.type === 'flat_agent' ? `${money(b.value)} flat` : `${money(b.value)} fee`) : 'not set');
const FLAG: Record<string, string> = { overdue: 'Overdue steps', closing_soon: 'Closing soon', no_closing_date: 'No closing date', expiring_soon: 'Agreement ending soon' };
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

function Tile({ label, value, sub, href, tone }: { label: string; value: string | number; sub?: string; href: string; tone?: string }) {
  return (
    <Link href={href} className="bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-5 transition block">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${tone ?? 'text-blue-400'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </Link>
  );
}

export default function BrokerageHome({ compact = false }: { compact?: boolean }) {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/oversight/home');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load your brokerage');
        setHome(json as Home);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your brokerage');
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (error) return <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-6">{error}</p>;
  if (!home) return <p className="text-sm text-slate-400 mb-6">Loading your brokerage…</p>;

  const { totals: t, commissions: c } = home;
  const todo: { text: string; href: string; tone: 'red' | 'amber' | 'slate' }[] = [
    ...(c.changeRequested > 0 ? [{ text: `${c.changeRequested} agent${c.changeRequested === 1 ? '' : 's'} asked for a change to a commission split`, href: '/dashboard/invoices', tone: 'red' as const }] : []),
    ...(home.unreadMessages > 0 ? [{ text: `${home.unreadMessages} unread message${home.unreadMessages === 1 ? '' : 's'} from your agents`, href: '/dashboard/collaborate#messages', tone: 'amber' as const }] : []),
    ...(c.closedWithoutStatement > 0 ? [{ text: `${c.closedWithoutStatement} recently closed deal${c.closedWithoutStatement === 1 ? ' has' : 's have'} no commission statement yet`, href: '/dashboard/transactions', tone: 'amber' as const }] : []),
    ...(c.readyToPay > 0 ? [{ text: `${c.readyToPay} agreed commission${c.readyToPay === 1 ? '' : 's'} ready to mark paid`, href: '/dashboard/invoices', tone: 'slate' as const }] : []),
    ...(t.pendingInvites > 0 ? [{ text: `${t.pendingInvites} invitation${t.pendingInvites === 1 ? '' : 's'} waiting for an answer`, href: '/dashboard/collaborate#agents', tone: 'slate' as const }] : []),
  ];
  const toneCls = { red: 'text-red-300', amber: 'text-amber-300', slate: 'text-slate-300' } as const;

  const tiles = (
    <div className={`grid grid-cols-2 ${compact ? 'md:grid-cols-5' : 'lg:grid-cols-5'} gap-3`}>
      <Tile label="Agents" value={t.agents} sub={t.pendingInvites ? `${t.pendingInvites} invited` : 'in your brokerage'} href="/dashboard/collaborate#agents" />
      <Tile label="Open deals" value={t.openDeals} sub={`${short(t.pipelineVolume)} pipeline`} href="/dashboard/transactions" />
      <Tile label="Open listings" value={t.openListings} sub={`${short(t.listPriceVolume)} listed`} href="/dashboard/listings" />
      <Tile label="Needs attention" value={t.needsAttention} sub="deals and listings" href="/dashboard/transactions" tone={t.needsAttention > 0 ? 'text-amber-400' : 'text-emerald-400'} />
      <Tile label="Closed this year" value={t.closedThisYear} sub={`${short(t.volumeThisYear)} volume`} href="/dashboard/collaborate#agents" tone="text-emerald-400" />
    </div>
  );

  // The summary above an owner's own dashboard: tiles and anything waiting on them, nothing more.
  if (compact) {
    if (t.agents === 0) {
      return (
        <section aria-label="Your brokerage" className="mb-8 bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-300">{t.pendingInvites > 0 ? `${t.pendingInvites} agent invitation${t.pendingInvites === 1 ? ' is' : 's are'} waiting for an answer.` : 'Invite your agents to see their deals and listings here.'}</p>
          <Link href="/dashboard/collaborate#agents" className="text-sm font-semibold text-blue-400 hover:text-blue-300">{t.pendingInvites > 0 ? 'See invitations' : 'Invite an agent'}</Link>
        </section>
      );
    }
    return (
      <section aria-label="Your brokerage" className="mb-8">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Your brokerage</h2>
          <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">Manage agents</Link>
        </div>
        {tiles}
        {todo.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {todo.slice(0, 3).map((x) => (
              <li key={x.text}><Link href={x.href} className={`${toneCls[x.tone]} hover:underline`}>{x.text}</Link></li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (t.agents === 0) {
    return (
      <div className="space-y-6">
        {tiles}
        <div className="bg-slate-700/50 border border-dashed border-slate-600 rounded-lg p-12 text-center">
          <h3 className="text-lg font-semibold text-slate-300 mb-2">{t.pendingInvites > 0 ? 'Waiting for your agents to accept' : 'Invite your first agent'}</h3>
          <p className="text-slate-400 mb-6 max-w-xl mx-auto">
            {t.pendingInvites > 0
              ? `${t.pendingInvites} invitation${t.pendingInvites === 1 ? ' is' : 's are'} out. Once an agent accepts, their deals, listings and production show up here, and you can set their commission and message them.`
              : 'Agents with their own Relay workspace join your brokerage by invitation. Then you see their deals and listings, what needs attention, and set up commissions here.'}
          </p>
          <Link href="/dashboard/collaborate#agents" className="inline-block px-6 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition">{t.pendingInvites > 0 ? 'See invitations' : 'Invite an agent'}</Link>
        </div>
      </div>
    );
  }

  const attention = [...home.attentionDeals.map((d) => ({ ...d, kind: 'deal' as const })), ...home.attentionListings.map((l) => ({ ...l, kind: 'listing' as const }))].slice(0, 8);

  return (
    <div className="space-y-6">
      {tiles}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">What needs you</h2>
          {todo.length === 0 && attention.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing is waiting on you. Your agents’ deals and listings are on track.</p>
          ) : (
            <>
              {todo.length > 0 && (
                <ul className="space-y-1.5 mb-4 text-sm">
                  {todo.map((x) => (
                    <li key={x.text}><Link href={x.href} className={`${toneCls[x.tone]} hover:underline`}>{x.text}</Link></li>
                  ))}
                </ul>
              )}
              {attention.length > 0 && (
                <ul className="divide-y divide-white/5">
                  {attention.map((a) => (
                    <li key={`${a.kind}-${a.id}`}>
                      <Link href={a.kind === 'deal' ? `/dashboard/collaborate/deals/${a.id}` : `/dashboard/collaborate/listings/${a.id}`} className="block py-2 hover:bg-white/5 rounded-lg px-1 -mx-1">
                        <p className="text-sm text-slate-100">{a.address || 'Untitled'} <span className="text-[10px] uppercase tracking-wide text-slate-500 ml-1">{a.kind}</span></p>
                        <p className="text-xs text-slate-400">{a.agent.name} · <span className="text-amber-300">{a.flags.map((f) => FLAG[f] ?? f).join(', ')}</span>{a.nextStep ? ` · Next: ${a.nextStep.name}` : ''}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">Closing in the next 30 days</h2>
          {home.closingSoon.length === 0 ? (
            <p className="text-sm text-slate-400">No closings are scheduled in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {home.closingSoon.map((d) => (
                <li key={d.id}>
                  <Link href={`/dashboard/collaborate/deals/${d.id}`} className="flex items-center gap-3 py-2 hover:bg-white/5 rounded-lg px-1 -mx-1">
                    <span className="w-14 shrink-0 text-xs font-semibold text-blue-300">{fmt(d.closingDate)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-100 truncate">{d.address || 'Untitled deal'}</span>
                      <span className="block text-xs text-slate-400 truncate">{d.agent.name}{d.nextStep ? ` · Next: ${d.nextStep.name}` : ''}</span>
                    </span>
                    {d.flags.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{FLAG[d.flags[0]] ?? d.flags[0]}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Commissions</h2>
          <Link href="/dashboard/invoices" className="text-sm text-blue-400 hover:text-blue-300">Open agent commissions</Link>
        </div>
        <div className="grid sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-slate-400">Not paid yet</p><p className="text-xl font-semibold text-slate-100">{c.unpaidCount}</p><p className="text-[11px] text-slate-500">{money(c.unpaidAgentCents / 100)} owed to agents</p></div>
          <div><p className="text-xs text-slate-400">Waiting for the agent</p><p className="text-xl font-semibold text-slate-100">{c.awaitingAgent}</p></div>
          <div><p className="text-xs text-slate-400">Ready to mark paid</p><p className="text-xl font-semibold text-emerald-300">{c.readyToPay}</p></div>
          <div><p className="text-xs text-slate-400">Change requested</p><p className={`text-xl font-semibold ${c.changeRequested ? 'text-red-300' : 'text-slate-100'}`}>{c.changeRequested}</p></div>
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Your agents</h2>
          <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">Manage and invite</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 pr-3 font-medium">Agent</th>
                <th className="py-2 pr-3 font-medium text-right">Open deals</th>
                <th className="py-2 pr-3 font-medium text-right">Listings</th>
                <th className="py-2 pr-3 font-medium text-right">Closed this year</th>
                <th className="py-2 pr-3 font-medium text-right">Needs attention</th>
                <th className="py-2 font-medium text-right">Base commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {home.agents.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3"><Link href={`/dashboard/collaborate/agents/${a.id}`} className="text-slate-100 hover:text-blue-300">{a.name}</Link></td>
                  <td className="py-2 pr-3 text-right text-slate-200">{a.openDeals}</td>
                  <td className="py-2 pr-3 text-right text-slate-200">{a.openListings}</td>
                  <td className="py-2 pr-3 text-right text-slate-200">{a.closedThisYear}</td>
                  <td className={`py-2 pr-3 text-right ${a.needsAttention ? 'text-amber-300' : 'text-slate-500'}`}>{a.needsAttention || '—'}</td>
                  <td className="py-2 text-right text-slate-300">{base(a.baseCommission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
