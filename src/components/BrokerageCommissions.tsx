'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import AgentCommissionTerms, { type BaseTerms } from './AgentCommissionTerms';

// Commission ledger. Owners see every deal's split with their agents, download a CSV, and set each agent's base terms here (the same terms as on the agent's profile).
// Agents see their own statements. Splits are proposed on the deal itself (the Commission box).

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Row {
  id: string;
  transactionId: string;
  statementNumber: string;
  splitType: SplitType;
  splitValue: number;
  status: 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  submitted?: boolean;
  gross: number;
  agentNet: number;
  brokerageNet: number;
  paidOn: string | null;
  property: string | null;
  agent?: { name: string };
  brokerage?: { name: string };
}

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent keeps ${v}%` : t === 'flat_agent' ? `Agent gets ${money(v)}` : `Brokerage fee ${money(v)}`);
const STATUS = { proposed: 'Waiting for the agent', change_requested: 'Change requested', accepted: 'Agreed', paid: 'Paid', void: 'Void' } as const;
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

interface RosterAgent extends BaseTerms { id: string; name: string }


export default function BrokerageCommissions({ mode }: { mode: 'owner' | 'agent' }) {
  const [asOwner, setAsOwner] = useState<Row[]>([]);
  const [asAgent, setAsAgent] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<RosterAgent[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/commissions');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load commissions');
      setAsOwner(json.asOwner ?? []);
      setAsAgent(json.asAgent ?? []);
      if (mode === 'owner') {
        const r = await authFetch('/api/oversight/roster');
        const rj = await r.json().catch(() => ({}));
        if (r.ok) setAgents(rj.agents ?? []);
      }
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load commissions');
    }
  }, [mode]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

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
              <td className="py-2 pr-3 text-slate-300">{mode === 'owner' && r.submitted ? <span className="text-amber-300">Needs your approval</span> : mode === 'agent' && r.submitted ? 'Sent, waiting for your brokerage' : mode === 'agent' && r.status === 'proposed' ? <span className="text-amber-300">Waiting for you</span> : mode === 'agent' && r.status === 'change_requested' ? 'Waiting for your brokerage' : STATUS[r.status]}{r.paidOn ? ` ${r.paidOn}` : ''}</td>
              <td className="py-2 text-right whitespace-nowrap">{mode === 'agent' && r.status === 'proposed' && <Link href={`/dashboard/transactions/${r.transactionId}`} className="text-xs font-semibold text-amber-300 hover:text-amber-200 mr-3">Review and agree</Link>}<button type="button" onClick={() => openStatement(r.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="text-xs text-blue-400 hover:text-blue-300">Statement</button></td>
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
          <h2 className="text-lg font-semibold text-slate-100">Agent commission terms</h2>
          <p className="text-xs text-slate-400 mb-3">Each agent&apos;s rate, split, fees and cap. These start every new deal&apos;s commission; you can still change them on a deal.</p>
          {agents.length === 0 ? <p className="text-sm text-slate-400">No agents on your roster yet.</p> : (
            <div className="divide-y divide-white/5">
              {agents.map((a) => (
                <div key={a.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/dashboard/collaborate/agents/${a.id}`} className="text-sm font-semibold text-slate-100 hover:text-blue-300">{a.name}</Link>
                  <div className="mt-1">
                    <AgentCommissionTerms terms={a} onSaved={load} title="Terms" showHelp={false} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{mode === 'owner' ? 'Commission ledger' : 'Your commission statements'}</h2>
            <p className="text-xs text-slate-400">{mode === 'owner' ? 'Propose a split from any deal’s page (Transactions → open a deal).' : 'Your brokerage proposes a split on each deal; you agree to it on the deal’s page.'}</p>
          </div>
          {mode === 'owner' && rows.length > 0 && <button type="button" onClick={downloadCsv} className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">Download CSV</button>}
        </div>
        {rows.length === 0 ? <p className="text-sm text-slate-400">No commission splits yet.</p> : table}
        <p className="text-[11px] text-slate-500 mt-3">Relay keeps the record only. Money is paid outside Relay for now, and the brokerage marks each one paid. This is not a tax document.</p>
      </div>
    </div>
  );
}
