'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';

// Commission ledger. Owners see every deal's split with their agents, can set each agent's default split and download a CSV.
// Agents see their own statements. Splits are proposed on the deal itself (the Commission box).

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Row {
  id: string;
  transactionId: string;
  statementNumber: string;
  splitType: SplitType;
  splitValue: number;
  status: 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  gross: number;
  agentNet: number;
  brokerageNet: number;
  paidOn: string | null;
  property: string | null;
  agent?: { name: string };
  brokerage?: { name: string };
}
interface AgentDefault { linkId: string; id: string; name: string; email: string | null; defaultSplit: { type: SplitType; value: number } | null }

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent keeps ${v}%` : t === 'flat_agent' ? `Agent gets ${money(v)}` : `Brokerage fee ${money(v)}`);
const STATUS = { proposed: 'Waiting for the agent', change_requested: 'Change requested', accepted: 'Agreed', paid: 'Paid', void: 'Void' } as const;
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';
const field = 'px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100';

export default function BrokerageCommissions({ mode }: { mode: 'owner' | 'agent' }) {
  const [asOwner, setAsOwner] = useState<Row[]>([]);
  const [asAgent, setAsAgent] = useState<Row[]>([]);
  const [agents, setAgents] = useState<AgentDefault[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { type: SplitType; value: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/commissions');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load commissions');
      setAsOwner(json.asOwner ?? []);
      setAsAgent(json.asAgent ?? []);
      setAgents(json.agents ?? []);
      setDrafts(Object.fromEntries((json.agents ?? []).map((a: AgentDefault) => [a.linkId, { type: a.defaultSplit?.type ?? 'percent', value: a.defaultSplit ? String(a.defaultSplit.value) : '' }])));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load commissions');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const saveDefault = async (a: AgentDefault, clear = false) => {
    setSaving(a.linkId);
    setError('');
    try {
      const d = drafts[a.linkId];
      const res = await authFetch(`/api/oversight/${a.linkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clear ? { splitType: null } : { splitType: d.type, splitValue: Number(d.value) }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save that');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving('');
    }
  };

  const downloadCsv = async () => {
    try {
      const res = await authFetch('/api/commissions?format=csv');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download the ledger');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the ledger');
    }
  };

  if (!loaded) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;
  const rows = mode === 'owner' ? asOwner : asAgent;
  const live = rows.filter((r) => r.status !== 'void');
  const open = live.filter((r) => r.status !== 'paid');
  const sum = (list: Row[], key: 'gross' | 'agentNet' | 'brokerageNet') => list.reduce((n, r) => n + r[key], 0);

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-2 pr-3 font-medium">Deal</th>
            <th className="py-2 pr-3 font-medium">{mode === 'owner' ? 'Agent' : 'Brokerage'}</th>
            <th className="py-2 pr-3 font-medium">Split</th>
            <th className="py-2 pr-3 font-medium text-right">Gross</th>
            <th className="py-2 pr-3 font-medium text-right">{mode === 'owner' ? 'To agent' : 'To you'}</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.id} className={r.status === 'void' ? 'opacity-50' : ''}>
              <td className="py-2 pr-3">
                <Link href={mode === 'owner' ? `/dashboard/collaborate/deals/${r.transactionId}` : `/dashboard/transactions/${r.transactionId}`} className="text-slate-100 hover:text-blue-300">{r.property || r.statementNumber}</Link>
                <div className="text-[11px] text-slate-500">{r.statementNumber}</div>
              </td>
              <td className="py-2 pr-3 text-slate-300">{mode === 'owner' ? r.agent?.name : r.brokerage?.name}</td>
              <td className="py-2 pr-3 text-slate-300">{splitText(r.splitType, r.splitValue)}</td>
              <td className="py-2 pr-3 text-right text-slate-200">{money(r.gross)}</td>
              <td className="py-2 pr-3 text-right text-emerald-300">{money(r.agentNet)}</td>
              <td className="py-2 pr-3 text-slate-300">{STATUS[r.status]}{r.paidOn ? ` ${r.paidOn}` : ''}</td>
              <td className="py-2 text-right"><button type="button" onClick={() => openStatement(r.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="text-xs text-blue-400 hover:text-blue-300">Statement</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid sm:grid-cols-3 gap-3">
        <div className={card}><p className="text-xs text-slate-400">Gross commission</p><p className="text-xl font-semibold text-slate-100">{money(sum(live, 'gross'))}</p></div>
        <div className={card}><p className="text-xs text-slate-400">{mode === 'owner' ? 'Net to agents' : 'Net to you'}</p><p className="text-xl font-semibold text-emerald-300">{money(sum(live, 'agentNet'))}</p></div>
        <div className={card}><p className="text-xs text-slate-400">Not paid yet ({open.length})</p><p className="text-xl font-semibold text-slate-100">{money(sum(open, mode === 'owner' ? 'brokerageNet' : 'agentNet'))}</p><p className="text-[11px] text-slate-500">{mode === 'owner' ? 'your net on open deals' : 'your net on open deals'}</p></div>
      </div>

      {mode === 'owner' && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Default split for each agent</h2>
          <p className="text-xs text-slate-400 mb-3">Used when you propose a split on one of their deals. You can still change it deal by deal, and the agent has to agree each time.</p>
          {agents.length === 0 ? <p className="text-sm text-slate-400">No agents have joined yet.</p> : (
            <ul className="divide-y divide-white/5">
              {agents.map((a) => {
                const d = drafts[a.linkId] ?? { type: 'percent' as SplitType, value: '' };
                return (
                  <li key={a.linkId} className="py-3 flex flex-wrap items-center gap-2">
                    <span className="flex-1 min-w-[10rem] text-sm text-slate-100">{a.name}<span className="block text-[11px] text-slate-500">{a.defaultSplit ? splitText(a.defaultSplit.type, a.defaultSplit.value) : 'No default'}</span></span>
                    <select value={d.type} onChange={(e) => setDrafts({ ...drafts, [a.linkId]: { ...d, type: e.target.value as SplitType } })} className={field}>
                      <option value="percent">Agent keeps %</option>
                      <option value="flat_agent">Agent gets $ (fixed)</option>
                      <option value="flat_brokerage">Brokerage fee $ (fixed)</option>
                    </select>
                    <input type="number" step="0.01" min="0" max={d.type === 'percent' ? 100 : undefined} value={d.value} onChange={(e) => setDrafts({ ...drafts, [a.linkId]: { ...d, value: e.target.value } })} placeholder={d.type === 'percent' ? '80' : '0.00'} className={`${field} w-24`} aria-label={`Default split for ${a.name}`} />
                    <button type="button" disabled={saving === a.linkId || d.value === ''} onClick={() => saveDefault(a)} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-50">Save</button>
                    {a.defaultSplit && <button type="button" disabled={saving === a.linkId} onClick={() => saveDefault(a, true)} className="text-xs text-slate-400 hover:text-red-300">Clear</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{mode === 'owner' ? 'Commission ledger' : 'Your commission statements'}</h2>
            <p className="text-xs text-slate-400">{mode === 'owner' ? 'Propose a split from any deal’s page (Collaborate → Agents → open a deal).' : 'Your brokerage proposes a split on each deal; you agree to it on the deal’s page.'}</p>
          </div>
          {mode === 'owner' && rows.length > 0 && <button type="button" onClick={downloadCsv} className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">Download CSV</button>}
        </div>
        {rows.length === 0 ? <p className="text-sm text-slate-400">No commission splits yet.</p> : table}
        <p className="text-[11px] text-slate-500 mt-3">Relay keeps the record only. Money is paid outside Relay for now, and the brokerage marks each one paid. This is not a tax document.</p>
      </div>
    </div>
  );
}
