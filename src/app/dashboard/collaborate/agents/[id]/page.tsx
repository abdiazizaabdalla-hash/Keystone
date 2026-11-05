'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import AgentDealRows, { type AgentDeal } from '@/components/AgentDealRows';
import AgentListingRows, { type AgentListing } from '@/components/AgentListingRows';
import { type CapView } from '@/components/CapNotice';
import AgentCommissionTerms, { type SplitType } from '@/components/AgentCommissionTerms';

// One agent in your brokerage, in full. Read-only apart from their base commission.

interface Profile {
  agent: { id: string; linkId: string | null; name: string; email: string | null; phone: string | null; license: string | null; focus: string[]; dealsPerYear: string | null; states: string[]; joinedAt: string | null; baseRate: { type: 'percent' | 'flat'; value: number } | null; baseCommission: { type: SplitType; value: number } | null; baseFees: { label: string; amount: number }[]; baseCap: { amount: number; reset: 'calendar_year' | 'anniversary'; start: string | null } | null; cap: CapView | null };
  production: { closedThisYear: number; volumeThisYear: number; closedLast30Days: number; activeDeals: number; pipelineVolume: number };
  openDeals: AgentDeal[];
  closedDeals: AgentDeal[];
  openListings: AgentListing[];
  closedListings: AgentListing[];
  commissions: { id: string; statementNumber: string; property: string | null; splitType: SplitType; splitValue: number; gross: number | null; agentNet: number | null; status: string; paidOn: string | null; transactionId: string }[];
  commissionTotals: { gross: number; agentNet: number; brokerageNet: number; unpaidCount: number; paidThisYear: number };
}

const money = (n: number | null) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent keeps ${v}%` : t === 'flat_agent' ? `Agent gets ${money(v)} per deal` : `Brokerage fee ${money(v)} per deal`);
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const res = await authFetch(`/api/oversight/agents/${id}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Could not load this agent');
    setData(json);
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load this agent'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!data) {
    return (
      <div className="p-4 md:p-8 max-w-5xl">
        <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">← Back to agents</Link>
        <p className="text-slate-400 text-sm mt-4">{error || 'Loading…'}</p>
      </div>
    );
  }

  const { agent, production: p, commissionTotals: ct } = data;
  const tile = (label: string, value: string | number, hint?: string) => (
    <div className={card}><p className="text-xs text-slate-400">{label}</p><p className="text-xl font-semibold text-slate-100">{value}</p>{hint && <p className="text-[11px] text-slate-500">{hint}</p>}</div>
  );

  return (
    <div className="p-4 md:p-8 max-w-5xl space-y-5">
      <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">← Back to agents</Link>

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-semibold text-slate-100">{agent.name}</h1>
            <p className="text-sm text-slate-400">{[agent.email, agent.phone, agent.license && `License ${agent.license}`].filter(Boolean).join(' · ')}</p>
            {agent.joinedAt && <p className="text-xs text-slate-500 mt-0.5">In your brokerage since {new Date(agent.joinedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
          </div>
          <Link href={`/dashboard/collaborate?with=${id}#messages`} className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">Message</Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.states.map((s) => <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300">{s}</span>)}
          {agent.focus.map((f) => <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">{f}</span>)}
          {agent.dealsPerYear && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-300">{agent.dealsPerYear} deals a year</span>}
          {agent.states.length === 0 && agent.focus.length === 0 && !agent.dealsPerYear && <span className="text-xs text-slate-500">The agent has not filled in their profile yet.</span>}
        </div>
      </div>
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      <div className={card}>
        <AgentCommissionTerms terms={{ linkId: agent.linkId, baseRate: agent.baseRate, baseCommission: agent.baseCommission, baseFees: agent.baseFees, baseCap: agent.baseCap, cap: agent.cap }} onSaved={load} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tile('Active deals', p.activeDeals)}
        {tile('Pipeline', money(p.pipelineVolume))}
        {tile('Closed (30 days)', p.closedLast30Days)}
        {tile('Closed (this year)', p.closedThisYear)}
        {tile('Volume (this year)', money(p.volumeThisYear))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-3">Active transactions ({data.openDeals.length})</h2>
        {data.openDeals.length === 0 ? <p className={`${card} text-sm text-slate-400`}>No open deals.</p> : <AgentDealRows deals={data.openDeals} showAgent={false} />}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-3">Active listings ({data.openListings.length})</h2>
        {data.openListings.length === 0 ? <p className={`${card} text-sm text-slate-400`}>No open listings.</p> : <AgentListingRows listings={data.openListings} showAgent={false} />}
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Commissions</h2>
          <p className="text-xs text-slate-400">Confirmed: gross received {money(ct.gross)} · agent take-home {money(ct.agentNet)} · brokerage {money(ct.brokerageNet)} · paid to agent this year {money(ct.paidThisYear)} · {ct.unpaidCount} not paid yet</p>
        </div>
        {data.commissions.length === 0 ? <p className="text-sm text-slate-400">No commission statements yet. One is made automatically when a deal goes under contract, once this agent’s base terms are set.</p> : (
          <ul className="divide-y divide-white/5 text-sm">
            {data.commissions.map((c) => (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link href={`/dashboard/collaborate/deals/${c.transactionId}`} className="flex-1 min-w-[10rem] text-slate-100 hover:text-blue-300">{c.property || c.statementNumber}<span className="block text-[11px] text-slate-500">{c.statementNumber} · {splitText(c.splitType, c.splitValue)}</span></Link>
                <span className="text-slate-300">{c.gross === null ? '—' : money(c.gross)}</span>
                <span className="text-emerald-300">{c.agentNet === null ? '—' : money(c.agentNet)}</span>
                <span className="text-xs text-slate-400 w-28">{c.status === 'paid' ? `Paid ${c.paidOn ?? ''}` : c.status === 'estimate' ? 'Estimate' : c.status.replace('_', ' ')}</span>
                {c.status !== 'estimate' && <button type="button" onClick={() => openStatement(c.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="text-xs text-blue-400 hover:text-blue-300">Statement</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.closedListings.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">Past listings</h2>
          <AgentListingRows listings={data.closedListings} showAgent={false} />
        </div>
      )}

      {data.closedDeals.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">Recently closed</h2>
          <AgentDealRows deals={data.closedDeals} showAgent={false} />
        </div>
      )}
    </div>
  );
}
