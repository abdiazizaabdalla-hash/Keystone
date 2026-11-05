'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import AgentDealRows, { type AgentDeal } from '@/components/AgentDealRows';
import AgentListingRows, { type AgentListing } from '@/components/AgentListingRows';
import CapNotice, { type CapView } from '@/components/CapNotice';

// One agent in your brokerage, in full. Read-only apart from their base commission.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
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
const field = 'px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100';

export default function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [rateType, setRateType] = useState<'percent' | 'flat'>('percent');
  const [rateValue, setRateValue] = useState('');
  const [type, setType] = useState<SplitType>('percent');
  const [value, setValue] = useState('');
  const [fees, setFees] = useState<{ label: string; amount: string }[]>([]);
  const [capOn, setCapOn] = useState(false);
  const [capAmount, setCapAmount] = useState('');
  const [capReset, setCapReset] = useState<'calendar_year' | 'anniversary'>('calendar_year');
  const [capStart, setCapStart] = useState('');
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

  const startEdit = () => {
    if (!data) return;
    const a = data.agent;
    setRateType(a.baseRate?.type ?? 'percent');
    setRateValue(a.baseRate ? String(a.baseRate.value) : '');
    setType(a.baseCommission?.type ?? 'percent');
    setValue(a.baseCommission ? String(a.baseCommission.value) : '');
    setFees(a.baseFees.map((f) => ({ label: f.label, amount: String(f.amount) })));
    setCapOn(!!a.baseCap);
    setCapAmount(a.baseCap ? String(a.baseCap.amount) : '');
    setCapReset(a.baseCap?.reset ?? 'calendar_year');
    setCapStart(a.baseCap?.start ?? '');
    setEditing(true);
  };

  const saveBase = async (clear = false) => {
    if (!data?.agent.linkId) return;
    setSaving(true);
    setError('');
    try {
      const body = clear
        ? { commissionType: null, splitType: null, fees: [], cap: null }
        : { ...(rateValue === '' ? { commissionType: null } : { commissionType: rateType, commissionValue: Number(rateValue) }), splitType: type, splitValue: Number(value), fees: fees.map((f) => ({ label: f.label, amount: f.amount })), cap: capOn ? { amount: Number(capAmount), reset: capReset, start: capStart || null } : null };
      const res = await authFetch(`/api/oversight/${data.agent.linkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-100">Base commission terms</h2>
            <p className="text-sm text-slate-300">{agent.baseRate ? (agent.baseRate.type === 'percent' ? `Commission rate: ${agent.baseRate.value}% of the sale price` : `Commission: ${money(agent.baseRate.value)} flat fee per deal`) : 'No commission rate set'}</p>
            <p className="text-sm text-slate-300">{agent.baseCommission ? splitText(agent.baseCommission.type, agent.baseCommission.value) : 'Not set yet'}</p>
            {agent.baseFees.length > 0 && <p className="text-xs text-slate-400">Fees from the agent’s share: {agent.baseFees.map((f) => `${f.label} ${money(f.amount)}`).join(', ')}</p>}
            {agent.baseCap && <p className="text-xs text-slate-400">Cap: {money(agent.baseCap.amount)} {agent.baseCap.reset === 'calendar_year' ? 'per calendar year' : `per year from ${agent.baseCap.start ?? 'their start date'}`}</p>}
            <p className="text-[11px] text-slate-500 mt-1">Nothing about commission shows until a deal closes. Then you are told, and Relay makes a statement from these terms: the sale price times the commission rate gives the expected gross, which you confirm from the closing documents. You can change the rate, split and fees on any deal. Nothing is assumed: with no split set, no statement is made.</p>
          </div>
          {!editing && <button type="button" onClick={startEdit} className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">{agent.baseCommission ? 'Change' : 'Set base commission'}</button>}
        </div>
        {agent.cap && !editing && <CapNotice cap={agent.cap} who="owner" />}
        {editing && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-slate-400 mb-1">Commission rate (what the sale earns before the split)</p>
              <div className="flex flex-wrap items-center gap-2">
                <select value={rateType} onChange={(e) => setRateType(e.target.value as 'percent' | 'flat')} className={field} aria-label="Commission rate type">
                  <option value="percent">% of the sale price</option>
                  <option value="flat">Flat fee $</option>
                </select>
                <input type="number" step="0.001" min="0" max={rateType === 'percent' ? 100 : undefined} value={rateValue} onChange={(e) => setRateValue(e.target.value)} className={`${field} w-28`} aria-label="Commission rate value" placeholder={rateType === 'percent' ? 'e.g. 3' : '0.00'} />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Optional. It gives each deal an expected gross commission; you still enter the actual amount from the closing documents.</p>
            </div>
            <p className="text-xs text-slate-400 -mb-1">Split between the brokerage and the agent</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={type} onChange={(e) => setType(e.target.value as SplitType)} className={field} aria-label="Split type">
                <option value="percent">Agent keeps %</option>
                <option value="flat_agent">Agent gets $ (fixed)</option>
                <option value="flat_brokerage">Brokerage fee $ (fixed)</option>
              </select>
              <input type="number" step="0.01" min="0" max={type === 'percent' ? 100 : undefined} value={value} onChange={(e) => setValue(e.target.value)} className={`${field} w-28`} aria-label="Base commission value" placeholder={type === 'percent' ? 'e.g. 70' : '0.00'} />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">Fees taken from the agent’s share on every deal (optional)</p>
              {fees.map((f, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <input value={f.label} placeholder="Transaction fee" onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`${field} flex-1`} />
                  <input type="number" step="0.01" min="0" value={f.amount} placeholder="0.00" onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${field} w-28`} />
                  <button type="button" onClick={() => setFees(fees.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 text-sm" aria-label="Remove fee">✕</button>
                </div>
              ))}
              {fees.length < 10 && <button type="button" onClick={() => setFees([...fees, { label: '', amount: '' }])} className="text-xs text-blue-400 hover:text-blue-300">+ Add a fee</button>}
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} /> This agent has a cap</label>
              {capOn && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-slate-400">Cap ($ the agent pays the brokerage)<input type="number" step="0.01" min="0" value={capAmount} onChange={(e) => setCapAmount(e.target.value)} className={`${field} block mt-1 w-40`} /></label>
                  <label className="text-xs text-slate-400">Resets
                    <select value={capReset} onChange={(e) => setCapReset(e.target.value as 'calendar_year' | 'anniversary')} className={`${field} block mt-1`}>
                      <option value="calendar_year">Every January 1</option>
                      <option value="anniversary">On the agent’s anniversary</option>
                    </select>
                  </label>
                  {capReset === 'anniversary' && <label className="text-xs text-slate-400">Anniversary date<input type="date" value={capStart} onChange={(e) => setCapStart(e.target.value)} className={`${field} block mt-1`} /></label>}
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-1">Relay shows how close the agent is and warns near the cap. It does not change any split yet.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={saving || value === '' || (capOn && capAmount === '')} onClick={() => saveBase()} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-50">Save</button>
              {(agent.baseCommission || agent.baseFees.length > 0 || agent.baseCap) && <button type="button" disabled={saving} onClick={() => saveBase(true)} className="text-xs text-slate-400 hover:text-red-300">Clear all terms</button>}
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-400">Cancel</button>
            </div>
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
