'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';

// The brokerage owner's view of money by agent: every commission split, grouped under the agent it belongs to, with that
// agent's base commission, what has been paid and what is still open. Statements open as PDFs.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Row {
  id: string;
  transactionId: string;
  statementNumber: string;
  splitType: SplitType;
  splitValue: number;
  status: 'estimate' | 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  submitted?: boolean;
  gross: number | null;
  agentNet: number | null;
  brokerageNet: number | null;
  paidOn: string | null;
  property: string | null;
  agent: { id: string; name: string };
}
interface AgentDefault { id: string; name: string; defaultSplit: { type: SplitType; value: number } | null }

const money = (n: number | null) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent keeps ${v}%` : t === 'flat_agent' ? `Agent gets ${money(v)}` : `Brokerage fee ${money(v)}`);
const STATUS = { estimate: 'Estimate · confirm after closing', proposed: 'Confirmed · agent reviewing', change_requested: 'Change requested', accepted: 'Agreed', paid: 'Paid', void: 'Void' } as const;
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function BrokerageInvoices({ onCreateInvoice }: { onCreateInvoice: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<AgentDefault[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/commissions');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load the commissions');
      setRows(json.asOwner ?? []);
      setAgents(json.agents ?? []);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the commissions');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // One group per agent who has joined, including agents with nothing yet, so the base commission is always visible.
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; base: AgentDefault['defaultSplit']; rows: Row[] }>();
    for (const a of agents) map.set(a.id, { id: a.id, name: a.name, base: a.defaultSplit, rows: [] });
    for (const r of rows) {
      const g = map.get(r.agent.id) ?? { id: r.agent.id, name: r.agent.name, base: null, rows: [] };
      g.rows.push(r);
      map.set(r.agent.id, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, agents]);

  if (!loaded) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;

  // Estimates have no amounts yet, so the totals count confirmed statements only.
  const live = rows.filter((r) => r.status !== 'void' && r.status !== 'estimate');
  const estimates = rows.filter((r) => r.status === 'estimate').length;
  const open = live.filter((r) => r.status !== 'paid');
  const sum = (list: Row[], key: 'gross' | 'agentNet' | 'brokerageNet') => list.reduce((n, r) => n + (r[key] ?? 0), 0);

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

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className={card}><p className="text-xs text-slate-400">Gross commission received (confirmed)</p><p className="text-xl font-semibold text-slate-100">{money(sum(live, 'gross'))}</p>{estimates > 0 && <p className="text-[11px] text-slate-500">{estimates} estimate{estimates === 1 ? '' : 's'} not counted until confirmed</p>}</div>
        <div className={card}><p className="text-xs text-slate-400">Net to agents</p><p className="text-xl font-semibold text-emerald-300">{money(sum(live, 'agentNet'))}</p></div>
        <div className={card}><p className="text-xs text-slate-400">Not paid yet ({open.length})</p><p className="text-xl font-semibold text-slate-100">{money(sum(open, 'agentNet'))}</p><p className="text-[11px] text-slate-500">owed to agents on open splits</p></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Commission statements by agent. Propose a split from a deal’s page; set the base commission on the agent’s profile.</p>
        <div className="flex gap-2">
          {rows.length > 0 && <button type="button" onClick={downloadCsv} className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-600 text-slate-200 hover:border-slate-500">Download CSV</button>}
          <button type="button" onClick={onCreateInvoice} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-400 text-white">New invoice</button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className={`${card} text-sm text-slate-300`}>Agents show up here once they join your brokerage.</div>
      ) : (
        groups.map((g) => {
          const gl = g.rows.filter((r) => r.status !== 'void' && r.status !== 'estimate');
          const go = gl.filter((r) => r.status !== 'paid');
          return (
            <section key={g.id} className={card} aria-label={`${g.name} commissions`}>
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <Link href={`/dashboard/collaborate/agents/${g.id}`} className="text-base font-semibold text-slate-100 hover:text-blue-300">{g.name}</Link>
                  <p className="text-xs text-slate-400">Base commission: {g.base ? splitText(g.base.type, g.base.value) : 'not set'}</p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>Gross {money(sum(gl, 'gross'))} · To agent <span className="text-emerald-300">{money(sum(gl, 'agentNet'))}</span></p>
                  <p>{go.length} not paid yet · {money(sum(go, 'agentNet'))}</p>
                </div>
              </div>
              {g.rows.length === 0 ? (
                <p className="text-sm text-slate-500">No commission splits yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400">
                        <th className="py-2 pr-3 font-medium">Deal</th>
                        <th className="py-2 pr-3 font-medium">Split</th>
                        <th className="py-2 pr-3 font-medium text-right">Gross received</th>
                        <th className="py-2 pr-3 font-medium text-right">Agent take-home</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {g.rows.map((r) => (
                        <tr key={r.id} className={r.status === 'void' ? 'opacity-50' : ''}>
                          <td className="py-2 pr-3">
                            <Link href={`/dashboard/collaborate/deals/${r.transactionId}`} className="text-slate-100 hover:text-blue-300">{r.property || r.statementNumber}</Link>
                            <div className="text-[11px] text-slate-500">{r.statementNumber}</div>
                          </td>
                          <td className="py-2 pr-3 text-slate-300">{splitText(r.splitType, r.splitValue)}</td>
                          <td className="py-2 pr-3 text-right text-slate-200">{r.gross === null ? <span className="text-slate-500" title="Estimate, not confirmed">—</span> : money(r.gross)}</td>
                          <td className="py-2 pr-3 text-right text-emerald-300">{r.agentNet === null ? <span className="text-slate-500">—</span> : money(r.agentNet)}</td>
                          <td className="py-2 pr-3 text-slate-300">{r.submitted ? <span className="text-amber-300">Needs your approval</span> : r.status === 'estimate' ? <span className="text-amber-300">{STATUS.estimate}</span> : STATUS[r.status]}{r.paidOn ? ` ${r.paidOn}` : ''}</td>
                          <td className="py-2 text-right"><button type="button" onClick={() => openStatement(r.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="text-xs text-blue-400 hover:text-blue-300">Statement</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
      <p className="text-[11px] text-slate-500">Relay keeps the record only. Money is paid outside Relay for now, and the brokerage marks each one paid. This is not a tax document.</p>
    </div>
  );
}
