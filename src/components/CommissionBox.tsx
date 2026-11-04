'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import { computeSplit } from '@/lib/commissionMath';
import CapNotice, { type CapView } from '@/components/CapNotice';

// The commission on one deal, between the brokerage and its agent (never Relay's own coordination fees). Nothing shows until the deal
// closes. Then it is an ESTIMATE built from the agent's commission rate (a percent of the sale price, or a flat fee) and split, and the brokerage owner confirms the actual gross commission the
// brokerage received; the agent then reviews it and agrees or asks for a change; the owner records when the agent was paid.
// Only the owner can confirm amounts or payment. Nothing here moves money. Renders nothing for anyone who is not a party to it.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Fee { label: string; amount: number }
interface Rate { type: 'percent' | 'flat'; value: number }
interface Estimate { gross: number | null; agentShare: number | null; brokerageShare: number | null; deductionsTotal: number | null; agentNet: number | null; brokerageNet: number | null }
interface View {
  rate?: Rate | null;
  estimate?: Estimate | null;
  id: string;
  statementNumber: string;
  splitType: SplitType;
  splitValue: number;
  deductions: Fee[];
  status: 'estimate' | 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  grossStatus: 'estimate' | 'confirmed';
  confirmedAt: string | null;
  changeNote: string | null;
  submitted?: boolean;
  paymentPreference: 'relay' | 'outside' | null;
  paidOn: string | null;
  paidNote: string | null;
  gross: number | null;
  agentShare: number | null;
  brokerageShare: number | null;
  deductionsTotal: number | null;
  agentNet: number | null;
  brokerageNet: number | null;
  agentPercentOfGross: number | null;
}
interface Terms { commission?: Rate | null; split: { type: SplitType; value: number } | null; fees: Fee[] }
interface Data { purchasePrice?: number | null; role: 'owner' | 'agent' | null; canPropose?: boolean; defaultSplit?: { type: SplitType; value: number } | null; terms?: Terms | null; cap?: CapView | null; dealClosed?: boolean; commission: View | null }

const money = (n: number | null) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number, you = false) =>
  t === 'percent' ? `${you ? 'You keep' : 'Agent keeps'} ${v}% · brokerage keeps ${Math.round((100 - v) * 1000) / 1000}%` : t === 'flat_agent' ? `${you ? 'You get' : 'Agent gets'} ${money(v)}` : `Brokerage fee ${money(v)}${you ? ', you keep the rest' : ''}`;
const rateText = (r: Rate) => (r.type === 'percent' ? `${r.value}% of the sale price` : `${money(r.value)} flat fee`);
const STATUS: Record<View['status'], { label: string; cls: string }> = {
  estimate: { label: 'Estimate · not confirmed', cls: 'bg-amber-500/20 text-amber-300' },
  proposed: { label: 'Confirmed · agent reviewing', cls: 'bg-sky-500/20 text-sky-300' },
  change_requested: { label: 'Agent asked for a change', cls: 'bg-orange-500/20 text-orange-300' },
  accepted: { label: 'Agreed', cls: 'bg-emerald-500/20 text-emerald-300' },
  paid: { label: 'Paid', cls: 'bg-blue-500/20 text-blue-300' },
  void: { label: 'Void', cls: 'bg-slate-500/20 text-slate-300' },
};
const field = 'px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100 w-full';
const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-50';

export default function CommissionBox({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const [confirmStripe, setConfirmStripe] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [gross, setGross] = useState('');
  const [rateType, setRateType] = useState<'percent' | 'flat'>('percent');
  const [rateValue, setRateValue] = useState('');
  const [tryAmount, setTryAmount] = useState<string | null>(null);
  const [splitType, setSplitType] = useState<SplitType>('percent');
  const [splitValue, setSplitValue] = useState('');
  const [fees, setFees] = useState<{ label: string; amount: string }[]>([]);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState('');
  const [paidNote, setPaidNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/commissions?transaction=${encodeURIComponent(transactionId)}`);
      if (!res.ok) return setData({ role: null, commission: null });
      setData(await res.json());
    } catch {
      setData({ role: null, commission: null });
    }
  }, [transactionId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const startForm = (c: View | null, d: Data) => {
    setGross(c && c.gross !== null ? String(c.gross) : '');
    const rate = c?.rate ?? d.terms?.commission ?? null;
    setRateType(rate?.type ?? 'percent');
    setRateValue(rate ? String(rate.value) : '');
    setSplitType(c ? c.splitType : d.terms?.split?.type ?? d.defaultSplit?.type ?? 'percent');
    setSplitValue(c ? String(c.splitValue) : d.terms?.split ? String(d.terms.split.value) : d.defaultSplit ? String(d.defaultSplit.value) : '');
    setFees(c ? c.deductions.map((f) => ({ label: f.label, amount: String(f.amount) })) : (d.terms?.fees ?? []).map((f) => ({ label: f.label, amount: String(f.amount) })));
    setEditing(true);
  };

  const call = async (url: string, method: string, body: unknown, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save that');
      after?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  if (!data || !data.role) return null;
  const c = data.commission;
  const isOwner = data.role === 'owner';
  if (data.role === 'agent' && !c) return null;
  // Commission does not exist until the deal closes.
  if (!c && !data.dealClosed) return null;

  const action = (a: string, extra: Record<string, unknown> = {}, after?: () => void) => call(`/api/commissions/${c!.id}`, 'PATCH', { action: a, ...extra }, after);
  const isEstimate = c?.status === 'estimate';
  const you = !isOwner;

  // What the commission would be at an amount typed in. A preview only: it is not saved and it is not a statement.
  const preview = (() => {
    if (!c || tryAmount === null) return null;
    const g = Number(tryAmount);
    if (!(g > 0)) return null;
    try {
      const r = computeSplit({ gross: g, splitType: c.splitType, splitValue: c.splitValue, deductions: c.deductions });
      return { gross: g, agentNet: r.agentNetCents / 100, brokerageNet: r.brokerageNetCents / 100 };
    } catch {
      return null;
    }
  })();

  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Commission</h2>
          <p className="text-xs text-slate-400">{isOwner ? 'Between your brokerage and this agent only. Separate from any Relay coordination fees.' : 'Between you and your brokerage only. Separate from any fees for a coordinator on Relay.'}</p>
        </div>
        {c && (() => {
          const st = c.submitted ? (isOwner ? { label: 'Needs your approval', cls: 'bg-amber-500/20 text-amber-300' } : { label: 'Sent to your brokerage', cls: 'bg-blue-500/20 text-blue-300' }) : STATUS[c.status];
          return <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>;
        })()}
      </div>
      {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1.5 mb-3">{error}</p>}

      {c && isEstimate && !editing && (
        <>
          <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm text-amber-200 font-medium">Estimate. No amount is confirmed yet.</p>
            <p className="text-xs text-slate-300 mt-1">
              {isOwner
                ? 'This deal has closed. Confirm the gross commission your brokerage actually received, from the closing documents, so the agent can review it.'
                : 'This deal has closed. Your brokerage will confirm the commission it received from the closing documents, and then you can review it here. Until then, no amount counts as real.'}
            </p>
          </div>
          <dl className="text-sm space-y-1 mt-3">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Commission rate</dt><dd className="text-slate-200 text-right">{c.rate ? rateText(c.rate) : 'Not set'}</dd></div>
            {c.estimate && c.estimate.gross !== null && <div className="flex justify-between gap-3"><dt className="text-slate-400">Expected gross commission</dt><dd className="text-slate-200">about {money(c.estimate.gross)}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-slate-400">{you ? 'Your split' : 'Split'}</dt><dd className="text-slate-200 text-right">{splitText(c.splitType, c.splitValue, you)}</dd></div>
            {c.deductions.map((f, i) => (
              <div key={i} className="flex justify-between gap-3"><dt className="text-slate-400">{f.label} <span className="text-slate-500">({you ? 'from your share' : 'from the agent’s share'})</span></dt><dd className="text-slate-200">− {money(f.amount)}</dd></div>
            ))}
            {c.deductions.length === 0 && <div className="flex justify-between gap-3"><dt className="text-slate-400">Fees</dt><dd className="text-slate-500">None set</dd></div>}
            {c.estimate && c.estimate.agentNet !== null && <div className="flex justify-between gap-3 pt-1 border-t border-white/10"><dt className="text-slate-300 font-medium">{you ? 'Expected take-home' : 'Expected to the agent'}</dt><dd className="text-amber-200 font-medium">about {money(c.estimate.agentNet)}</dd></div>}
          </dl>
          {c.estimate && <p className="text-[11px] text-slate-500 mt-1">An estimate from the sale price and the commission rate. The closing documents decide the real amount.</p>}
          {tryAmount === null ? (
            <button type="button" onClick={() => setTryAmount('')} className="mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium">Try an amount →</button>
          ) : (
            <div className="mt-3 rounded-lg bg-slate-900/40 border border-white/10 p-3 text-sm">
              <label className="text-xs text-slate-400 block">If the brokerage receives this gross commission ($)
                <input type="number" min="0" step="0.01" value={tryAmount} onChange={(e) => setTryAmount(e.target.value)} className={`${field} mt-1 max-w-[12rem]`} aria-label="Try a gross commission" />
              </label>
              {preview && (
                <div className="mt-2 space-y-0.5">
                  <p className="text-slate-300">Your brokerage receives <span className="text-slate-100 font-medium">{money(preview.gross)}</span></p>
                  <p className="text-slate-300">{you ? 'You would take home' : 'The agent would take home'} <span className="text-emerald-300 font-semibold">{money(preview.agentNet)}</span>; the brokerage keeps {money(preview.brokerageNet)}</p>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-2">Preview only. It is not saved and not a statement.</p>
              <button type="button" onClick={() => setTryAmount(null)} className="mt-1 text-xs text-slate-400 hover:text-slate-200">Close</button>
            </div>
          )}
          {c.changeNote && <p className="text-xs text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-lg px-2 py-1.5 mt-3">{isOwner ? 'Agent flagged: ' : 'You flagged: '}{c.changeNote}</p>}
          <p className="text-[11px] text-slate-500 mt-2">{c.statementNumber}</p>

          {isOwner && (
            <div className="flex gap-2 flex-wrap mt-3">
              {data.canPropose && <button type="button" onClick={() => startForm(c, data)} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Confirm actual commission</button>}
              {data.canPropose && <button type="button" onClick={() => { startForm(c, data); setGross(''); }} className={`${btn} border border-slate-600 text-slate-200 hover:border-slate-500`}>Edit terms for this deal</button>}
              <button type="button" disabled={busy} onClick={() => window.confirm('Void this commission statement? The agent will be told.') && action('void')} className={`${btn} text-slate-400 hover:text-red-300`}>Void</button>
            </div>
          )}
          {!isOwner && !asking && <button type="button" onClick={() => setAsking(true)} className={`${btn} mt-3 border border-slate-600 text-slate-200 hover:border-slate-500`}>Something looks wrong</button>}
          {!isOwner && asking && (
            <div className="mt-3 space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={3} placeholder="What should your brokerage fix before confirming?" className={field} />
              <div className="flex gap-2">
                <button type="button" disabled={busy || !note.trim()} onClick={() => action('request_change', { note }, () => { setAsking(false); setNote(''); })} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Send to my brokerage</button>
                <button type="button" onClick={() => setAsking(false)} className={`${btn} text-slate-300`}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {c && !isEstimate && c.status !== 'void' && !editing && (
        <>
          <p className="text-[11px] text-slate-500 mb-2">Confirmed amounts{c.confirmedAt ? `, ${c.confirmedAt.slice(0, 10)}` : ''}{isOwner ? ' (confirmed by your brokerage)' : ' by your brokerage'}</p>
          <dl className="text-sm space-y-1">
            {data.purchasePrice ? <div className="flex justify-between gap-3"><dt className="text-slate-400">Sale price</dt><dd className="text-slate-200">{money(data.purchasePrice)}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-slate-400">{you ? 'Commission your brokerage received (gross)' : 'Gross commission received by the brokerage'}</dt><dd className="text-slate-100 font-medium">{money(c.gross)}{data.purchasePrice && c.gross ? <span className="block text-[11px] text-slate-500 font-normal text-right">{Math.round((c.gross / data.purchasePrice) * 100 * 1000) / 1000}% of the sale price</span> : null}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">{you ? 'Your split' : 'Split'}</dt><dd className="text-slate-200 text-right">{splitText(c.splitType, c.splitValue, you)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">{you ? 'Your share' : 'Agent’s share'}{c.splitType === 'percent' ? ` (${c.splitValue}%)` : ''}</dt><dd className="text-slate-200">{money(c.agentShare)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Brokerage’s share{c.splitType === 'percent' ? ` (${Math.round((100 - c.splitValue) * 1000) / 1000}%)` : ''}</dt><dd className="text-slate-200">{money(c.brokerageShare)}</dd></div>
            {c.deductions.map((f, i) => (
              <div key={i} className="flex justify-between gap-3"><dt className="text-slate-400">{f.label}</dt><dd className="text-slate-200">− {money(f.amount)}</dd></div>
            ))}
            <div className="flex justify-between gap-3 pt-1 border-t border-white/10"><dt className="text-slate-300 font-medium">{you ? 'You take home' : 'Net to agent'}</dt><dd className="text-emerald-300 font-semibold">{money(c.agentNet)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-300 font-medium">{you ? 'Your brokerage keeps' : 'Net to brokerage'}</dt><dd className="text-slate-100 font-semibold">{money(c.brokerageNet)}</dd></div>
          </dl>
          <p className="text-[11px] text-slate-500 mt-2">{c.statementNumber}{c.paidOn ? ` · paid ${c.paidOn}${c.paidNote ? ` (${c.paidNote})` : ''}` : ''}</p>
          {c.status === 'change_requested' && c.changeNote && <p className="text-xs text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-lg px-2 py-1.5 mt-2">Agent’s note: {c.changeNote}</p>}

          {!isOwner && c.status === 'proposed' && !asking && (
            <div className="flex gap-2 mt-3">
              <button type="button" disabled={busy} onClick={() => action('accept')} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Agree to this statement</button>
              <button type="button" disabled={busy} onClick={() => setAsking(true)} className={`${btn} border border-slate-600 text-slate-200 hover:border-slate-500`}>Ask for a change</button>
            </div>
          )}
          {!isOwner && asking && (
            <div className="mt-3 space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={3} placeholder="What should change?" className={field} />
              <div className="flex gap-2">
                <button type="button" disabled={busy || !note.trim()} onClick={() => action('request_change', { note }, () => { setAsking(false); setNote(''); })} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Send</button>
                <button type="button" onClick={() => setAsking(false)} className={`${btn} text-slate-300`}>Cancel</button>
              </div>
            </div>
          )}
          {!isOwner && c.status === 'accepted' && (
            <div className="mt-3 text-sm">
              <p className="text-slate-200 mb-1">{data.dealClosed ? 'This deal closed. How do you want to be paid?' : 'How do you want to be paid when this closes?'}</p>
              <div className="flex gap-2 flex-wrap">
                {(['relay', 'outside'] as const).map((p) => (
                  <button key={p} type="button" disabled={busy} onClick={() => action('set_preference', { preference: p })} className={`${btn} border ${c.paymentPreference === p ? 'border-blue-400 bg-blue-500/20 text-blue-200' : 'border-slate-600 text-slate-200 hover:border-slate-500'}`}>
                    {p === 'relay' ? 'Through Relay' : 'Outside Relay'}
                  </button>
                ))}
              </div>
              {c.paymentPreference === 'relay' && (
                <div className="mt-2 text-xs text-slate-400">
                  <p>Payments through Relay are not switched on yet, so your brokerage will pay you the usual way and record it here. You can get your Stripe account ready now so you are set when it is.</p>
                  <button type="button" onClick={() => setConfirmStripe(true)} className="mt-1.5 text-blue-400 hover:text-blue-300 font-semibold">Set up payouts with Stripe →</button>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-2">Only your brokerage can record that you were paid.</p>
            </div>
          )}
          {isOwner && c.paymentPreference && c.status !== 'paid' && <p className="text-xs text-slate-400 mt-2">The agent chose to be paid {c.paymentPreference === 'relay' ? 'through Relay (not switched on yet, so pay and record it here)' : 'outside Relay'}.</p>}

          {isOwner && (
            <div className="flex gap-2 flex-wrap mt-3">
              {c.submitted && <button type="button" disabled={busy} onClick={() => action('approve')} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Approve</button>}
              {data.canPropose && c.status !== 'paid' && <button type="button" onClick={() => startForm(c, data)} className={`${btn} border border-slate-600 text-slate-200 hover:border-slate-500`}>{c.status === 'accepted' ? 'Revise (agent must agree again)' : c.submitted ? 'Edit before approving (agent agrees again)' : 'Edit'}</button>}
              {c.status === 'accepted' && !paying && <button type="button" disabled title="Payments through Relay are not switched on yet" className={`${btn} border border-slate-700 text-slate-500 cursor-not-allowed`}>Pay through Relay (soon)</button>}
              {c.status === 'accepted' && !paying && <button type="button" onClick={() => { setPaidOn(new Date().toISOString().slice(0, 10)); setPaying(true); }} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Mark agent paid</button>}
              {c.status !== 'paid' && <button type="button" disabled={busy} onClick={() => window.confirm('Void this commission statement? The agent will be told.') && action('void')} className={`${btn} text-slate-400 hover:text-red-300`}>Void</button>}
            </div>
          )}
          {isOwner && paying && (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-slate-400 block">Agent paid on<input type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} className={`${field} mt-1`} /></label>
              <input value={paidNote} onChange={(e) => setPaidNote(e.target.value.slice(0, 500))} placeholder="Note (check number, ACH...)" className={field} />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => action('mark_paid', { paidOn, note: paidNote }, () => setPaying(false))} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Save</button>
                <button type="button" onClick={() => setPaying(false)} className={`${btn} text-slate-300`}>Cancel</button>
              </div>
            </div>
          )}
          <button type="button" onClick={() => openStatement(c.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="block mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium">Open statement (PDF) →</button>
        </>
      )}

      {c && c.status === 'void' && !editing && (
        <p className="text-sm text-slate-400">This statement ({c.statementNumber}) was voided.{isOwner && data.canPropose ? ' ' : ''}
          {isOwner && data.canPropose && <button type="button" onClick={() => startForm(null, data)} className="text-blue-400 hover:text-blue-300 font-medium">Start a new commission</button>}
        </p>
      )}

      {isOwner && !c && !editing && (
        data.canPropose ? (
          <div>
            <p className="text-sm text-slate-300 mb-2">
              {data.terms?.split
                ? `No commission statement on this deal yet. This agent’s base split: ${splitText(data.terms.split.type, data.terms.split.value)}.`
                : 'No commission terms are set for this agent, so Relay has not made an estimate. Set the terms for this deal (or the agent’s base terms on their page).'}
            </p>
            <button type="button" onClick={() => startForm(null, data)} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Set commission terms</button>
          </div>
        ) : <p className="text-sm text-slate-400">Commission statements need an active brokerage link with this agent.</p>
      )}

      {data.cap && !editing && <CapNotice cap={data.cap} who={isOwner ? 'owner' : 'agent'} />}

      {isOwner && editing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const body: Record<string, unknown> = { transactionId, splitType, splitValue: Number(splitValue), deductions: fees.map((f) => ({ label: f.label, amount: f.amount })) };
            if (gross.trim() !== '') body.gross = Number(gross);
            if (rateValue.trim() !== '') {
              body.commissionType = rateType;
              body.commissionValue = Number(rateValue);
            }
            call('/api/commissions', 'POST', body, () => setEditing(false));
          }}
        >
          <label className="text-xs text-slate-400 block">Gross commission your brokerage received ($), from the closing documents
            <input type="number" step="0.01" min="0" value={gross} onChange={(e) => setGross(e.target.value)} className={`${field} mt-1`} placeholder={c?.estimate?.gross ? `Expected about ${money(c.estimate.gross)}. Leave blank to keep this an estimate` : 'Leave blank to keep this an estimate'} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">Commission rate
              <select value={rateType} onChange={(e) => setRateType(e.target.value as 'percent' | 'flat')} className={`${field} mt-1`}>
                <option value="percent">% of the sale price</option>
                <option value="flat">Flat fee $</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">{rateType === 'percent' ? 'Percent' : 'Amount ($)'}
              <input type="number" step="0.001" min="0" max={rateType === 'percent' ? 100 : undefined} value={rateValue} onChange={(e) => setRateValue(e.target.value)} className={`${field} mt-1`} placeholder="Optional" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">Split
              <select value={splitType} onChange={(e) => setSplitType(e.target.value as SplitType)} className={`${field} mt-1`}>
                <option value="percent">Agent keeps %</option>
                <option value="flat_agent">Agent gets $ (fixed)</option>
                <option value="flat_brokerage">Brokerage fee $ (fixed)</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">{splitType === 'percent' ? 'Percent' : 'Amount ($)'}
              <input type="number" step="0.01" min="0" max={splitType === 'percent' ? 100 : undefined} required value={splitValue} onChange={(e) => setSplitValue(e.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Fees taken from the agent’s share (optional)</p>
            {fees.map((f, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input value={f.label} placeholder="Transaction fee" onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={field} />
                <input type="number" step="0.01" min="0" value={f.amount} placeholder="0.00" onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${field} w-28`} />
                <button type="button" onClick={() => setFees(fees.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 text-sm" aria-label="Remove fee">✕</button>
              </div>
            ))}
            {fees.length < 10 && <button type="button" onClick={() => setFees([...fees, { label: '', amount: '' }])} className="text-xs text-blue-400 hover:text-blue-300">+ Add a fee</button>}
          </div>
          <p className="text-[11px] text-slate-500">{gross.trim() !== '' ? 'Confirming sends the statement to the agent, who has to agree before it counts.' : 'Without a gross commission this stays an estimate and the agent is not asked to agree to anything.'} Nothing is paid through Relay.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>{gross.trim() !== '' ? (c && !isEstimate ? 'Send revised statement' : 'Confirm and send to agent') : 'Save terms'}</button>
            <button type="button" onClick={() => setEditing(false)} className={`${btn} text-slate-300`}>Cancel</button>
          </div>
        </form>
      )}
      {confirmStripe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="stripe-confirm-title" onClick={() => setConfirmStripe(false)}>
          <div className="w-full max-w-md bg-slate-800 border border-white/10 rounded-2xl p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="stripe-confirm-title" className="text-lg font-bold text-slate-100 mb-2">Go to Settings to connect Stripe?</h3>
            <ul className="text-sm text-slate-300 space-y-2 list-disc ml-5 mb-4">
              <li>This takes you to <span className="font-semibold">Settings → Getting paid</span>, where you choose Connect Stripe.</li>
              <li>Stripe opens in a new tab and asks for your identity and bank details. Relay never sees or stores them.</li>
              <li>It takes a few minutes, and nothing is charged. You can stop at any point and finish later.</li>
              <li>Your brokerage still records this commission as paid in Relay until online payments are switched on.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmStripe(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100">Not now</button>
              <button type="button" onClick={() => router.push('/dashboard/settings#getting-paid')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-500 hover:bg-blue-400 text-white">Go to Settings</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
