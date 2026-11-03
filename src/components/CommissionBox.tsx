'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';

// The commission on one deal. The brokerage owner proposes the split; the agent agrees or asks for a change; the owner
// records when it was paid. Nothing here moves money. Renders nothing for anyone who is not a party to the deal's commission.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
interface Fee { label: string; amount: number }
interface View {
  id: string;
  statementNumber: string;
  splitType: SplitType;
  splitValue: number;
  deductions: Fee[];
  status: 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  changeNote: string | null;
  paymentPreference: 'relay' | 'outside' | null;
  paidOn: string | null;
  paidNote: string | null;
  gross: number;
  agentShare: number;
  brokerageShare: number;
  deductionsTotal: number;
  agentNet: number;
  brokerageNet: number;
  agentPercentOfGross: number;
}
interface Data { role: 'owner' | 'agent' | null; canPropose?: boolean; defaultSplit?: { type: SplitType; value: number } | null; dealClosed?: boolean; commission: View | null }

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `Agent keeps ${v}%` : t === 'flat_agent' ? `Agent gets ${money(v)}` : `Brokerage fee ${money(v)}`);
const STATUS: Record<View['status'], { label: string; cls: string }> = {
  proposed: { label: 'Waiting for the agent', cls: 'bg-amber-500/20 text-amber-300' },
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
    setGross(c ? String(c.gross) : '');
    setSplitType(c ? c.splitType : d.defaultSplit?.type ?? 'percent');
    setSplitValue(c ? String(c.splitValue) : d.defaultSplit ? String(d.defaultSplit.value) : '');
    setFees(c ? c.deductions.map((f) => ({ label: f.label, amount: String(f.amount) })) : []);
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

  const action = (a: string, extra: Record<string, unknown> = {}, after?: () => void) => call(`/api/commissions/${c!.id}`, 'PATCH', { action: a, ...extra }, after);

  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Commission</h2>
          <p className="text-xs text-slate-400">{isOwner ? 'Between you and this agent only.' : 'Between you and your brokerage only.'}</p>
        </div>
        {c && <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>}
      </div>
      {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1.5 mb-3">{error}</p>}

      {c && c.status !== 'void' && !editing && (
        <>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Gross commission</dt><dd className="text-slate-100 font-medium">{money(c.gross)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Split</dt><dd className="text-slate-200 text-right">{splitText(c.splitType, c.splitValue)}</dd></div>
            {c.deductions.map((f, i) => (
              <div key={i} className="flex justify-between gap-3"><dt className="text-slate-400">{f.label}</dt><dd className="text-slate-200">− {money(f.amount)}</dd></div>
            ))}
            <div className="flex justify-between gap-3 pt-1 border-t border-white/10"><dt className="text-slate-300 font-medium">Net to agent</dt><dd className="text-emerald-300 font-semibold">{money(c.agentNet)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-300 font-medium">Net to brokerage</dt><dd className="text-slate-100 font-semibold">{money(c.brokerageNet)}</dd></div>
          </dl>
          <p className="text-[11px] text-slate-500 mt-2">{c.statementNumber}{c.paidOn ? ` · paid ${c.paidOn}${c.paidNote ? ` (${c.paidNote})` : ''}` : ''}</p>
          {c.status === 'change_requested' && c.changeNote && <p className="text-xs text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-lg px-2 py-1.5 mt-2">Agent’s note: {c.changeNote}</p>}

          {!isOwner && c.status === 'proposed' && !asking && (
            <div className="flex gap-2 mt-3">
              <button type="button" disabled={busy} onClick={() => action('accept')} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Agree to this split</button>
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
            </div>
          )}
          {isOwner && c.paymentPreference && c.status !== 'paid' && <p className="text-xs text-slate-400 mt-2">The agent chose to be paid {c.paymentPreference === 'relay' ? 'through Relay (not switched on yet, so pay and record it here)' : 'outside Relay'}.</p>}

          {isOwner && (
            <div className="flex gap-2 flex-wrap mt-3">
              {data.canPropose && c.status !== 'paid' && <button type="button" onClick={() => startForm(c, data)} className={`${btn} border border-slate-600 text-slate-200 hover:border-slate-500`}>{c.status === 'accepted' ? 'Revise (agent must agree again)' : 'Edit'}</button>}
              {c.status === 'accepted' && !paying && <button type="button" onClick={() => { setPaidOn(new Date().toISOString().slice(0, 10)); setPaying(true); }} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Mark paid</button>}
              {c.status !== 'paid' && <button type="button" disabled={busy} onClick={() => window.confirm('Void this commission statement? The agent will be told.') && action('void')} className={`${btn} text-slate-400 hover:text-red-300`}>Void</button>}
            </div>
          )}
          {isOwner && paying && (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-slate-400 block">Paid on<input type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} className={`${field} mt-1`} /></label>
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
          {isOwner && data.canPropose && <button type="button" onClick={() => startForm(null, data)} className="text-blue-400 hover:text-blue-300 font-medium">Propose a new split</button>}
        </p>
      )}

      {isOwner && !c && !editing && (
        data.canPropose ? (
          <div>
            <p className="text-sm text-slate-300 mb-2">No commission split on this deal yet.{data.defaultSplit ? ` This agent’s default: ${splitText(data.defaultSplit.type, data.defaultSplit.value)}.` : ''}</p>
            <button type="button" onClick={() => startForm(null, data)} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>Propose a split</button>
          </div>
        ) : <p className="text-sm text-slate-400">Commission splits need an active brokerage link with this agent.</p>
      )}

      {isOwner && editing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            call('/api/commissions', 'POST', { transactionId, gross: Number(gross), splitType, splitValue: Number(splitValue), deductions: fees.map((f) => ({ label: f.label, amount: f.amount })) }, () => setEditing(false));
          }}
        >
          <label className="text-xs text-slate-400 block">Gross commission ($)<input type="number" step="0.01" min="0" required value={gross} onChange={(e) => setGross(e.target.value)} className={`${field} mt-1`} /></label>
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
            <p className="text-xs text-slate-400 mb-1">Fees charged to the agent (optional)</p>
            {fees.map((f, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input value={f.label} placeholder="Transaction fee" onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={field} />
                <input type="number" step="0.01" min="0" value={f.amount} placeholder="0.00" onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${field} w-28`} />
                <button type="button" onClick={() => setFees(fees.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 text-sm" aria-label="Remove fee">✕</button>
              </div>
            ))}
            {fees.length < 10 && <button type="button" onClick={() => setFees([...fees, { label: '', amount: '' }])} className="text-xs text-blue-400 hover:text-blue-300">+ Add a fee</button>}
          </div>
          <p className="text-[11px] text-slate-500">The agent sees this and has to agree before it counts. Nothing is paid through Relay.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${btn} bg-blue-500 hover:bg-blue-400 text-white`}>{c ? 'Send revised split' : 'Send to agent'}</button>
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
