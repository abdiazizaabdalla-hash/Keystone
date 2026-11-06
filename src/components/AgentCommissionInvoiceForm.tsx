'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import CapNotice, { type CapView } from '@/components/CapNotice';

// A commission invoice from an agent to the brokerage they belong to. Nothing is typed in: the brokerage is the bill-to, the agent picks
// one of their deals (open or closed), and every figure is worked out from the terms the brokerage set for them (sale price x commission
// rate, then the split, fees and cap). It is an estimate until the brokerage confirms the actual commission from the closing documents.
// It is the same record as the deal's commission statement, so a deal is never invoiced twice. Nothing here moves money.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Fee { label: string; amount: number }
interface Rate { type: 'percent' | 'flat'; value: number }
interface Statement {
  id: string;
  statementNumber: string;
  status: 'estimate' | 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  submitted?: boolean;
  splitType: SplitType;
  splitValue: number;
  deductions: Fee[];
  rate?: Rate | null;
  estimate?: { gross: number | null; agentShare: number | null; brokerageShare: number | null; deductionsTotal: number | null; agentNet: number | null } | null;
  gross: number | null;
  agentShare: number | null;
  brokerageShare: number | null;
  deductionsTotal: number | null;
  agentNet: number | null;
  paidOn: string | null;
}
interface Preview { salePrice: number | null; rate: Rate | null; split: { type: SplitType; value: number } | null; fees: Fee[]; gross: number | null; agentShare: number | null; brokerageShare: number | null; deductionsTotal: number | null; agentNet: number | null }
interface Deal { id: string; address: string | null; fileNumber: string | null; status: string | null; closed: boolean; closingDate: string | null; purchasePrice: number | null; statement: Statement | null; preview: Preview | null }
interface Options { inBrokerage: boolean; brokerage?: { name: string; email: string | null }; termsSet?: boolean; cap?: CapView | null; deals?: Deal[] }

const money = (n: number | null | undefined) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);
const rateText = (r: Rate) => (r.type === 'percent' ? `${r.value}% of the sale price` : `${money(r.value)} flat fee`);
const splitSides = (t: SplitType, v: number) => (t === 'percent' ? `You keep ${v}% · brokerage keeps ${Math.round((100 - v) * 1000) / 1000}%` : t === 'flat_agent' ? `You get ${money(v)}, the brokerage keeps the rest` : `Brokerage fee ${money(v)}, you keep the rest`);
const STATE: Record<Statement['status'], string> = {
  estimate: 'Sent. Your brokerage confirms the actual commission from the closing documents.',
  proposed: 'Your brokerage confirmed the commission. Review it on the deal and agree or ask for a change.',
  change_requested: 'Waiting for your brokerage.',
  accepted: 'You agreed. Your brokerage pays you, then records it as paid.',
  paid: 'Paid.',
  void: 'Void.',
};
const field = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-blue-500 focus:outline-none';
const row = 'flex items-baseline justify-between gap-4 py-1.5';

export default function AgentCommissionInvoiceForm({ initialTransactionId, onClose, onSent }: { initialTransactionId?: string; onClose: () => void; onSent: () => void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [dealId, setDealId] = useState(initialTransactionId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // The agent's own additions before sending: lines taken from their share (a referral fee) and a note for the brokerage.
  const [extras, setExtras] = useState<{ label: string; amount: string }[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/commissions/invoice-options');
      const json = res.ok ? ((await res.json()) as Options) : { inBrokerage: false };
      setOptions(json);
      // Start on the deal the agent came from, or the first one still to invoice.
      setDealId((current) => current || (json.deals ?? []).find((d) => !d.statement)?.id || '');
    } catch {
      setOptions({ inBrokerage: false });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const deal = useMemo(() => options?.deals?.find((d) => d.id === dealId) ?? null, [options, dealId]);

  // One set of figures whether the invoice is still a preview or already sent.
  const calc = useMemo(() => {
    if (!deal) return null;
    const s = deal.statement;
    if (s) {
      const confirmed = s.status !== 'estimate';
      const f = confirmed ? s : (s.estimate ?? null);
      return { confirmed, salePrice: deal.purchasePrice, rate: s.rate ?? null, split: { type: s.splitType, value: s.splitValue }, fees: s.deductions ?? [], gross: f?.gross ?? null, agentShare: f?.agentShare ?? null, brokerageShare: f?.brokerageShare ?? null, deductionsTotal: f?.deductionsTotal ?? null, agentNet: f?.agentNet ?? null };
    }
    const p = deal.preview;
    return p ? { confirmed: false, ...p } : null;
  }, [deal]);

  const send = async () => {
    if (!deal) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const res = await authFetch('/api/commissions/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: deal.id, extraFees: extras.map((x) => ({ label: x.label, amount: x.amount })), note: message }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send the invoice');
      setNote(`Sent to ${options?.brokerage?.name ?? 'your brokerage'}.`);
      setExtras([]);
      setMessage('');
      await load();
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the invoice');
    } finally {
      setBusy(false);
    }
  };

  if (options === null) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!options.inBrokerage) return null;

  const extraTotal = extras.reduce((n, x) => n + (Number(x.amount) || 0), 0);
  const deals = options.deals ?? [];
  const open = deals.filter((d) => !d.closed);
  const closed = deals.filter((d) => d.closed);
  const label = (d: Deal) => `${d.address || d.fileNumber || 'Deal'}${d.statement ? ` · ${d.statement.statementNumber} sent` : ''}${d.closed ? ' · closed' : d.closingDate ? ` · closes ${date(d.closingDate)}` : ''}`;

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Commission invoice</h2>
          <p className="text-xs text-slate-400">Your share of a deal&apos;s commission, billed to your brokerage. The amounts come from the terms your brokerage set for you.</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">Close</button>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-800/50 px-4 py-3">
        <p className="text-xs text-slate-400">Bill to</p>
        <p className="text-sm font-semibold text-slate-100">{options.brokerage?.name}</p>
        {options.brokerage?.email && <p className="text-xs text-slate-400">{options.brokerage.email}</p>}
        <p className="text-[11px] text-slate-500 mt-1">Your brokerage, filled in for you.</p>
      </div>

      {!options.termsSet ? (
        <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">{options.brokerage?.name} has not set your commission terms yet, so there is nothing to calculate. Ask them to set your split and commission rate, then come back here.</p>
      ) : deals.length === 0 ? (
        <p className="text-sm text-slate-300">You have no deals yet. Add a transaction and it appears here.</p>
      ) : (
        <>
          <div>
            <label htmlFor="commission-deal" className="block text-xs text-slate-400 mb-1">Transaction</label>
            <select id="commission-deal" className={field} value={dealId} onChange={(e) => { setDealId(e.target.value); setNote(''); setError(''); setExtras([]); setMessage(''); }}>
              <option value="">Choose a deal…</option>
              {open.length > 0 && <optgroup label="Active deals">{open.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}</optgroup>}
              {closed.length > 0 && <optgroup label="Closed deals">{closed.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}</optgroup>}
            </select>
          </div>

          {deal && calc && (
            <div className="rounded-xl border border-white/10 bg-slate-800/40 px-4 py-3 text-sm">
              <div className={row}><span className="text-slate-400">Sale price</span><span className="text-slate-100">{deal.purchasePrice ? money(deal.purchasePrice) : 'Not on the deal yet'}</span></div>
              {(calc.rate || !calc.confirmed) && <div className={row}><span className="text-slate-400">Commission rate</span><span className="text-slate-100">{calc.rate ? rateText(calc.rate) : 'Not set by your brokerage'}</span></div>}
              <div className={`${row} border-t border-white/10`}><span className="text-slate-300">{calc.confirmed ? 'Commission your brokerage received' : 'Expected commission'}</span><span className="font-semibold text-slate-100">{calc.gross !== null ? money(calc.gross) : '—'}</span></div>
              {calc.split && <div className={row}><span className="text-slate-400">Split</span><span className="text-slate-100 text-right">{splitSides(calc.split.type, calc.split.value)}</span></div>}
              {calc.agentShare !== null && <div className={row}><span className="text-slate-400">Your share before fees</span><span className="text-slate-100">{money(calc.agentShare)}</span></div>}
              {calc.fees.map((f, i) => <div key={i} className={row}><span className="text-slate-400">{f.label}{(f as Fee & { by?: string }).by === 'agent' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-sky-300">added by you</span>}</span><span className="text-slate-300">−{money(f.amount)}</span></div>)}
              {!deal.statement && extras.filter((x) => Number(x.amount) > 0).map((x, i) => <div key={`x${i}`} className={row}><span className="text-slate-400">{x.label || 'Your line'} <span className="text-[10px] uppercase tracking-wide text-sky-300">added by you</span></span><span className="text-slate-300">−{money(Number(x.amount))}</span></div>)}
              <div className={`${row} border-t border-white/10`}><span className="text-slate-200 font-semibold">{calc.confirmed ? 'You take home' : 'Estimated take-home'}</span><span className="text-lg font-semibold text-emerald-300">{calc.agentNet !== null ? money(calc.agentNet - (deal.statement ? 0 : extraTotal)) : '—'}</span></div>
              {!calc.confirmed && <p className="text-[11px] text-slate-500 mt-1">An estimate. The actual commission can differ with negotiated amounts, concessions or referrals. Your brokerage confirms it from the closing documents, and you review it before anything is marked paid.</p>}
              {calc.gross === null && !deal.statement && <p className="text-xs text-amber-200 mt-2">{!calc.rate ? 'Your brokerage has not set a commission rate for you, so there is no expected commission. You can still send the invoice and they will confirm the amount.' : 'This deal has no sale price yet, so there is no expected commission. You can still send the invoice and they will confirm the amount.'}</p>}
            </div>
          )}

          {deal && !deal.statement && calc && (
            <div className="rounded-xl border border-white/10 bg-slate-800/40 px-4 py-3 space-y-2">
              <p className="text-xs text-slate-400">Anything to add before you send it? Your brokerage&apos;s terms and fees can&apos;t be changed here, but you can add a line of your own (like a referral fee) and a note.</p>
              {extras.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <input value={x.label} placeholder="Referral fee" maxLength={60} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} className={field} aria-label="Line name" />
                  <input type="number" step="0.01" min="0" value={x.amount} placeholder="0.00" onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} className={`${field} w-32`} aria-label="Line amount" />
                  <button type="button" onClick={() => setExtras(extras.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 text-sm px-1" aria-label="Remove line">✕</button>
                </div>
              ))}
              {extras.length < 8 && <button type="button" onClick={() => setExtras([...extras, { label: '', amount: '' }])} className="text-xs text-blue-400 hover:text-blue-300 font-medium">+ Add a line</button>}
              <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 1000))} rows={2} placeholder={`Note for ${options.brokerage?.name ?? 'your brokerage'} (optional)`} className={field} aria-label="Note for your brokerage" />
            </div>
          )}

          {options.cap && <CapNotice cap={options.cap} who="agent" />}

          {deal?.statement && <p className="text-sm text-slate-300">{deal.statement.statementNumber} · {deal.statement.submitted ? 'Sent. Waiting for your brokerage to approve it.' : STATE[deal.statement.status]}{deal.statement.paidOn ? ` ${deal.statement.paidOn}` : ''}</p>}
          {error && <p className="text-sm text-red-300">{error}</p>}
          {note && <p className="text-sm text-green-300">{note}</p>}

          <div className="flex flex-wrap gap-2">
            {deal && !deal.statement && (
              <button type="button" disabled={busy} onClick={send} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {busy ? 'Sending…' : `Send to ${options.brokerage?.name ?? 'your brokerage'}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
