'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import AgentCommissionTerms, { type BaseTerms } from './AgentCommissionTerms';
import CommissionInvoicePanel, { type PanelRow } from './CommissionInvoicePanel';

// The brokerage owner's view of money by agent: a banner per agent (base commission, what has been paid, what is still open) and,
// opened from it, that agent's invoices. Each invoice opens into the shared panel to confirm, edit, approve and mark paid; the PDF
// unlocks once both sides agree.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
type Row = PanelRow & {
  brokerageNet: number | null;
  agent: { id: string; name: string };
};
interface AgentDefault {
  id: string;
  name: string;
  linkId: string;
  defaultSplit: { type: SplitType; value: number } | null;
  terms: { commission: { type: 'percent' | 'flat'; value: number } | null; split: { type: SplitType; value: number } | null; fees: { label: string; amount: number }[]; cap: { capCents: number; reset: 'calendar_year' | 'anniversary'; anchor: string | null } | null };
}

const money = (n: number | null) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent ${v}% · Brokerage ${Math.round((100 - v) * 1000) / 1000}%` : t === 'flat_agent' ? `Agent gets ${money(v)}` : `Brokerage fee ${money(v)}`);
const STATUS = { estimate: 'Estimate · confirm after closing', proposed: 'Confirmed · agent reviewing', change_requested: 'Agent asked for a change', accepted: 'Agreed · ready to pay', paid: 'Paid', void: 'Void' } as const;
const needsYou = (r: Row) => r.status === 'estimate' ? r.dealStatus === 'Closed' : r.status === 'change_requested' || r.status === 'accepted';
const statusOf = (r: Row) => (r.submitted ? 'Needs your approval' : r.status === 'estimate' ? (r.dealStatus !== 'Closed' ? 'Sent by agent · confirm at closing' : STATUS.estimate) : STATUS[r.status]);
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function BrokerageInvoices({ onCreateInvoice }: { onCreateInvoice: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<AgentDefault[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  // Each agent's invoices stay folded until their banner is opened; one invoice at a time opens into its panel.
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

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
    const map = new Map<string, { id: string; name: string; base: AgentDefault['defaultSplit']; linkId: string | null; terms: AgentDefault['terms'] | null; rows: Row[] }>();
    for (const a of agents) map.set(a.id, { id: a.id, name: a.name, base: a.defaultSplit, linkId: a.linkId, terms: a.terms, rows: [] });
    for (const r of rows) {
      const g = map.get(r.agent.id) ?? { id: r.agent.id, name: r.agent.name, base: null, linkId: null, terms: null, rows: [] };
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
          const isOpen = openAgents.has(g.id);
          const toggle = () => setOpenAgents((prev) => { const next = new Set(prev); if (next.has(g.id)) next.delete(g.id); else next.add(g.id); return next; });
          const waiting = g.rows.filter(needsYou).length;
          return (
            <section key={g.id} className={`${card} !p-0 overflow-hidden`} aria-label={`${g.name} commissions`}>
              <div className="flex flex-wrap items-start justify-between gap-3 p-5 cursor-pointer" onClick={toggle}>
                <div className="min-w-0">
                  <Link href={`/dashboard/collaborate/agents/${g.id}`} onClick={(e) => e.stopPropagation()} className="text-base font-semibold text-slate-100 hover:text-blue-300">{g.name}</Link>
                  <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>Base commission: {g.base ? splitText(g.base.type, g.base.value) : 'not set'}</span>
                    {g.linkId && g.terms && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(g.id); }} className="text-blue-400 hover:text-blue-300 font-medium underline-offset-2 hover:underline">{g.base ? 'Edit' : 'Set'}</button>
                    )}
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="text-right text-xs text-slate-400">
                    <p>Gross {money(sum(gl, 'gross'))} · To agent <span className="text-emerald-300">{money(sum(gl, 'agentNet'))}</span></p>
                    <p>{go.length} not paid yet · {money(sum(go, 'agentNet'))}</p>
                    {waiting > 0 && <p className="text-amber-300 mt-0.5">{waiting} waiting on you</p>}
                  </div>
                  <button type="button" aria-expanded={isOpen} aria-label={isOpen ? `Hide ${g.name}'s invoices` : `Show ${g.name}'s invoices`} onClick={(e) => { e.stopPropagation(); toggle(); }} className="text-slate-400 hover:text-slate-200 text-xs px-1 pt-0.5">
                    <span className={`inline-block transition-transform ${isOpen ? 'rotate-180' : ''}`}><svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M5.5 7.5 10 12l4.5-4.5 1 1L10 14 4.5 8.5z" /></svg></span>
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-white/10 px-5 py-4 space-y-2">
                  {g.rows.length === 0 ? (
                    <p className="text-sm text-slate-500">No commission invoices yet.</p>
                  ) : (
                    g.rows.map((r) => {
                      const rowOpen = openRow === r.id;
                      return (
                        <div key={r.id} className={`rounded-xl border ${rowOpen ? 'border-white/25 bg-white/[0.03]' : 'border-white/10 hover:border-white/20'} ${r.status === 'void' ? 'opacity-50' : ''}`}>
                          <button type="button" aria-expanded={rowOpen} onClick={() => setOpenRow(rowOpen ? null : r.id)} className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-100 truncate">{r.property || r.statementNumber}</p>
                              <p className="text-[11px] text-slate-500">{r.statementNumber}</p>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                              <span className={needsYou(r) || r.submitted ? 'text-amber-300' : 'text-slate-300'}>{statusOf(r)}{r.paidOn ? ` ${r.paidOn}` : ''}</span>
                              <span className="font-semibold text-emerald-300 min-w-[6rem] text-right">{r.agentNet === null ? (r.estimate?.agentNet != null ? `≈ ${money(r.estimate.agentNet)}` : '—') : money(r.agentNet)}</span>
                              <span aria-hidden className={`text-slate-400 transition-transform ${rowOpen ? 'rotate-180' : ''}`}><svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M5.5 7.5 10 12l4.5-4.5 1 1L10 14 4.5 8.5z" /></svg></span>
                            </div>
                          </button>
                          {rowOpen && (
                            <div className="px-4 pb-4">
                              <CommissionInvoicePanel role="owner" row={r} counterpart={g.name} onChanged={load} />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
              {editing === g.id && g.linkId && g.terms && (
                <BaseCommissionDialog
                  name={g.name}
                  terms={{
                    linkId: g.linkId,
                    baseRate: g.terms.commission,
                    baseCommission: g.terms.split,
                    baseFees: g.terms.fees,
                    baseCap: g.terms.cap ? { amount: g.terms.cap.capCents / 100, reset: g.terms.cap.reset, start: g.terms.cap.anchor } : null,
                  }}
                  onClose={() => setEditing(null)}
                  onSaved={async () => { setEditing(null); await load(); }}
                />
              )}
            </section>
          );
        })
      )}
      <p className="text-[11px] text-slate-500">Relay keeps the record only. Money is paid outside Relay for now, and the brokerage marks each one paid. This is not a tax document.</p>
    </div>
  );
}

// A popup to change an agent's base commission: what a new invoice for that agent starts from. Invoices already sent keep the terms they were sent with.
function BaseCommissionDialog({ name, terms, onClose, onSaved }: { name: string; terms: BaseTerms; onClose: () => void; onSaved: () => void | Promise<void> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="base-commission-title" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800 border border-white/10 rounded-2xl p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 id="base-commission-title" className="text-lg font-bold text-slate-100">Base commission for {name}</h3>
        <p className="text-xs text-slate-400 mt-1 mb-4">This is what new deals and invoices start from. It applies to future deals only: invoices already sent keep the terms they were sent with, and you can still adjust any one invoice.</p>
        <AgentCommissionTerms terms={terms} autoEdit showHelp={false} onSaved={onSaved} onCancel={onClose} />
      </div>
    </div>
  );
}
