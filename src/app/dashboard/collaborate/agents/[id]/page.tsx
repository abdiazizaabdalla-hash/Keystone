'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import AgentDealRows, { type AgentDeal } from '@/components/AgentDealRows';
import AgentListingRows, { type AgentListing } from '@/components/AgentListingRows';

// One agent in your brokerage, in full. Read-only apart from their base commission.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Profile {
  agent: { id: string; linkId: string | null; name: string; email: string | null; phone: string | null; license: string | null; focus: string[]; dealsPerYear: string | null; states: string[]; joinedAt: string | null; baseCommission: { type: SplitType; value: number } | null };
  production: { closedThisYear: number; volumeThisYear: number; closedLast30Days: number; activeDeals: number; pipelineVolume: number };
  openDeals: AgentDeal[];
  closedDeals: AgentDeal[];
  openListings: AgentListing[];
  closedListings: AgentListing[];
  commissions: { id: string; statementNumber: string; property: string | null; splitType: SplitType; splitValue: number; gross: number; agentNet: number; status: string; paidOn: string | null; transactionId: string }[];
  commissionTotals: { gross: number; agentNet: number; brokerageNet: number; unpaidCount: number; paidThisYear: number };
}

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent keeps ${v}%` : t === 'flat_agent' ? `Agent gets ${money(v)} per deal` : `Brokerage fee ${money(v)} per deal`);
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';
const field = 'px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100';

export default function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<SplitType>('percent');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

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

  const saveBase = async (clear = false) => {
    if (!data?.agent.linkId) return;
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(`/api/oversight/${data.agent.linkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clear ? { splitType: null } : { splitType: type, splitValue: Number(value) }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save that');
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="p-4 md:p-8 max-w-5xl">
        <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">← Back to your agents</Link>
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
      <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">← Back to your agents</Link>

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-semibold text-slate-100">{agent.name}</h1>
            <p className="text-sm text-slate-400">{[agent.email, agent.phone, agent.license && `License ${agent.license}`].filter(Boolean).join(' · ')}</p>
            {agent.joinedAt && <p className="text-xs text-slate-500 mt-0.5">In your brokerage since {new Date(agent.joinedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
          </div>
          <Link href="/dashboard/collaborate#messages" className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">Message</Link>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Base commission</h2>
            <p className="text-sm text-slate-300">{agent.baseCommission ? splitText(agent.baseCommission.type, agent.baseCommission.value) : 'Not set yet'}</p>
            <p className="text-[11px] text-slate-500">Used when you propose a split on one of their deals; the agent still agrees deal by deal.</p>
          </div>
          {!editing && <button type="button" onClick={() => { setType(agent.baseCommission?.type ?? 'percent'); setValue(agent.baseCommission ? String(agent.baseCommission.value) : ''); setEditing(true); }} className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">{agent.baseCommission ? 'Change' : 'Set base commission'}</button>}
        </div>
        {editing && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as SplitType)} className={field}>
              <option value="percent">Agent keeps %</option>
              <option value="flat_agent">Agent gets $ (fixed)</option>
              <option value="flat_brokerage">Brokerage fee $ (fixed)</option>
            </select>
            <input type="number" step="0.01" min="0" max={type === 'percent' ? 100 : undefined} value={value} onChange={(e) => setValue(e.target.value)} className={`${field} w-28`} aria-label="Base commission value" placeholder={type === 'percent' ? '80' : '0.00'} />
            <button type="button" disabled={saving || value === ''} onClick={() => saveBase()} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-50">Save</button>
            {agent.baseCommission && <button type="button" disabled={saving} onClick={() => saveBase(true)} className="text-xs text-slate-400 hover:text-red-300">Clear</button>}
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400">Cancel</button>
          </div>
        )}
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
          <p className="text-xs text-slate-400">Gross {money(ct.gross)} · to agent {money(ct.agentNet)} · to brokerage {money(ct.brokerageNet)} · paid to agent this year {money(ct.paidThisYear)} · {ct.unpaidCount} not paid yet</p>
        </div>
        {data.commissions.length === 0 ? <p className="text-sm text-slate-400">No commission splits yet. Propose one from any of their deals.</p> : (
          <ul className="divide-y divide-white/5 text-sm">
            {data.commissions.map((c) => (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link href={`/dashboard/collaborate/deals/${c.transactionId}`} className="flex-1 min-w-[10rem] text-slate-100 hover:text-blue-300">{c.property || c.statementNumber}<span className="block text-[11px] text-slate-500">{c.statementNumber} · {splitText(c.splitType, c.splitValue)}</span></Link>
                <span className="text-slate-300">{money(c.gross)}</span>
                <span className="text-emerald-300">{money(c.agentNet)}</span>
                <span className="text-xs text-slate-400 w-28">{c.status === 'paid' ? `Paid ${c.paidOn ?? ''}` : c.status.replace('_', ' ')}</span>
                <button type="button" onClick={() => openStatement(c.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="text-xs text-blue-400 hover:text-blue-300">Statement</button>
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
