'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { downloadStatement, openStatement } from '@/lib/commissionClient';

// One commission invoice, opened. Used on both sides so the agent and the brokerage work on the same screen: what was sent, who it is
// waiting on, every line, and the edit and approval steps for whoever's turn it is. Nothing is edited in a PDF: the PDF is the
// final statement and only unlocks once the brokerage and the agent have both agreed. Nothing here moves money.

type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
export interface PanelFee { label: string; amount: number; by?: 'agent' }
interface Rate { type: 'percent' | 'flat'; value: number }
export interface PanelRow {
  id: string;
  transactionId: string;
  statementNumber: string;
  status: 'estimate' | 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';
  submitted?: boolean;
  changeNote?: string | null;
  splitType: SplitType;
  splitValue: number;
  deductions: PanelFee[];
  rate?: Rate | null;
  estimate?: { gross: number | null; agentShare: number | null; brokerageShare: number | null; deductionsTotal: number | null; agentNet: number | null } | null;
  gross: number | null;
  agentShare: number | null;
  brokerageShare: number | null;
  deductionsTotal: number | null;
  agentNet: number | null;
  brokerageNet?: number | null;
  salePrice?: number | null;
  grossPercent?: number | null;
  paidOn: string | null;
  paidNote?: string | null;
  dealStatus?: string | null;
  property: string | null;
}

const money = (n: number | null | undefined) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rateText = (r: Rate) => (r.type === 'percent' ? `${r.value}% of the sale price` : `${money(r.value)} flat fee`);
const splitText = (t: SplitType, v: number, you: boolean) =>
  t === 'percent' ? `${you ? 'You keep' : 'Agent keeps'} ${v}% · brokerage keeps ${Math.round((100 - v) * 1000) / 1000}%` : t === 'flat_agent' ? `${you ? 'You get' : 'Agent gets'} ${money(v)}, brokerage keeps the rest` : `Brokerage fee ${money(v)}, ${you ? 'you' : 'agent'} keeps the rest`;
const field = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-blue-500 focus:outline-none';
const btn = 'px-3.5 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${btn} bg-blue-500 hover:bg-blue-400 text-white`;
const ghost = `${btn} border border-white/15 hover:border-white/30 text-slate-200`;
const STEPS = ['Sent', 'Confirmed', 'Agreed', 'Paid'];

/** How far along the invoice is: 0 sent, 1 confirmed by the brokerage, 2 agreed by both, 3 paid. */
function stepOf(row: PanelRow): number {
  if (row.status === 'paid') return 3;
  if (row.status === 'accepted') return 2;
  if (row.status === 'proposed' || (row.status === 'change_requested' && !row.submitted)) return 1;
  return 0;
}

export default function CommissionInvoicePanel({ role, row, counterpart, onChanged }: { role: 'agent' | 'owner'; row: PanelRow; counterpart: string; onChanged: () => void }) {
  const isOwner = role === 'owner';
  const you = !isOwner;
  const closed = row.dealStatus === 'Closed';
  const confirmed = row.status !== 'estimate';
  const agreed = row.status === 'accepted' || row.status === 'paid';
  const awaitingAgent = row.status === 'proposed';
  const [mode, setMode] = useState<'view' | 'edit' | 'pay'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  // The figures to show: confirmed amounts, or the estimate worked out from the brokerage's terms.
  const f = confirmed ? row : { ...row, ...(row.estimate ?? { gross: null, agentShare: null, brokerageShare: null, deductionsTotal: null, agentNet: null }) };

  const run = async (url: string, method: string, body: unknown, ok: string, after?: () => void) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save that');
      setDone(ok);
      setMode('view');
      after?.();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };
  const patch = (action: string, extra: Record<string, unknown>, ok: string) => run(`/api/commissions/${row.id}`, 'PATCH', { action, ...extra }, ok);

  // --- what is waiting, and on whom ---
  const turn = (() => {
    if (row.status === 'void') return { mine: false, text: 'This invoice was voided.' };
    if (row.status === 'paid') return { mine: false, text: row.paidOn ? `Paid on ${row.paidOn.slice(0, 10)}.` : 'Paid.' };
    if (row.status === 'accepted') return { mine: isOwner, text: isOwner ? 'You both agree. Record the payment once it goes out.' : `You both agree. Waiting for ${counterpart} to pay you and record it.` };
    if (row.status === 'proposed') return { mine: !isOwner, text: isOwner ? `Confirmed. Waiting for ${counterpart} to agree.` : `${counterpart} confirmed the amounts. Agree to them, or ask for a change.` };
    if (row.status === 'change_requested' && row.submitted) return { mine: isOwner, text: isOwner ? 'Waiting for your approval.' : `Sent. Waiting for ${counterpart} to approve it.` };
    if (row.status === 'change_requested') return { mine: isOwner, text: isOwner ? `${counterpart} asked for a change. Edit the invoice and send it back.` : `You asked for a change. Waiting for ${counterpart} to revise it.` };
    if (isOwner) return { mine: true, text: closed ? 'Confirm the actual commission from the closing documents.' : 'Sent before closing. Review the lines now; confirm the actual commission once the deal closes.' };
    return { mine: false, text: closed ? `Sent. Waiting for ${counterpart} to confirm the actual commission.` : `Sent. ${counterpart} confirms the actual commission from the closing documents once the deal closes.` };
  })();

  const step = stepOf(row);
  const feeTag = (fee: PanelFee) => (fee.by === 'agent' ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1 py-px">added by {isOwner ? 'agent' : 'you'}</span> : null);

  return (
    <div className="border-t border-white/10 pt-4 space-y-4">
      <ol className="flex items-center gap-1.5 text-[11px]" aria-label="Where this invoice is">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-1.5 min-w-0">
            <span className={`h-5 min-w-5 px-1.5 rounded-full grid place-items-center font-semibold ${i <= step ? 'bg-emerald-500/25 text-emerald-300' : 'bg-white/5 text-slate-500'}`}>{i <= step ? '✓' : i + 1}</span>
            <span className={i <= step ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
            {i < STEPS.length - 1 && <span className={`h-px w-4 sm:w-8 ${i < step ? 'bg-emerald-500/40' : 'bg-white/10'}`} />}
          </li>
        ))}
      </ol>

      <p className={`text-sm rounded-lg px-3 py-2 border ${turn.mine ? 'bg-amber-500/10 border-amber-500/30 text-amber-100' : 'bg-white/5 border-white/10 text-slate-300'}`}>{turn.text}</p>
      {row.changeNote && row.status !== 'paid' && row.status !== 'accepted' && (
        <p className="text-sm rounded-lg px-3 py-2 border bg-orange-500/10 border-orange-500/30 text-orange-100"><span className="font-semibold">{isOwner ? 'Agent’s note: ' : 'Your note: '}</span>{row.changeNote}</p>
      )}

      {mode === 'view' && (
        <div className="rounded-xl border border-white/10 bg-slate-800/40 px-4 py-2 text-sm divide-y divide-white/5">
          <Line label="Sale price" value={row.salePrice ? money(row.salePrice) : 'Not on the deal yet'} />
          <Line label="Commission rate" value={row.rate ? rateText(row.rate) : 'Not set'} />
          <Line label={confirmed ? (you ? 'Commission your brokerage received' : 'Commission received') : 'Expected commission'} value={f.gross !== null ? money(f.gross) : '—'} strong note={confirmed && row.grossPercent != null && row.salePrice ? `${row.grossPercent}% of the sale price` : undefined} />
          <Line label="Split" value={splitText(row.splitType, row.splitValue, you)} />
          {f.agentShare !== null && <Line label={`${you ? 'Your' : 'Agent’s'} share before fees`} value={money(f.agentShare)} />}
          {row.deductions.map((fee, i) => (
            <Line key={i} label={<>{fee.label}{feeTag(fee)}</>} value={`−${money(fee.amount)}`} muted />
          ))}
          <Line label={confirmed ? (you ? 'You take home' : 'Net to agent') : (you ? 'Estimated take-home' : 'Estimated net to agent')} value={f.agentNet !== null ? money(f.agentNet) : '—'} total />
          {isOwner && confirmed && row.brokerageNet != null && <Line label="Net to brokerage" value={money(row.brokerageNet)} />}
        </div>
      )}
      {mode === 'view' && !confirmed && <p className="text-[11px] text-slate-500 -mt-2">An estimate. The actual commission can differ with negotiated amounts, concessions or referrals, and is confirmed from the closing documents.</p>}

      {mode === 'edit' && (isOwner ? <OwnerEditor row={row} closed={closed} busy={busy} onCancel={() => setMode('view')} onSave={(body, ok) => run('/api/commissions', 'POST', { transactionId: row.transactionId, ...body }, ok)} /> : <AgentEditor row={row} counterpart={counterpart} busy={busy} onCancel={() => setMode('view')} onSave={(action, body, ok) => patch(action, body, ok)} />)}

      {mode === 'pay' && <PayForm busy={busy} onCancel={() => setMode('view')} onSave={(paidOn, note) => patch('mark_paid', { paidOn, note }, 'Marked paid.')} />}

      {error && <p className="text-sm text-red-300">{error}</p>}
      {done && <p className="text-sm text-green-300">{done}</p>}

      {mode === 'view' && row.status !== 'void' && (
        <div className="flex flex-wrap items-center gap-2">
          {/* The agent's turn */}
          {!isOwner && awaitingAgent && <button type="button" disabled={busy} onClick={() => patch('accept', {}, 'You agreed. Your brokerage can now pay you and record it.')} className={primary}>Agree to this invoice</button>}
          {!isOwner && awaitingAgent && <button type="button" onClick={() => { setError(''); setDone(''); setMode('edit'); }} className={ghost}>Ask for a change</button>}
          {!isOwner && row.status === 'estimate' && <button type="button" onClick={() => { setError(''); setDone(''); setMode('edit'); }} className={ghost}>Edit my lines and note</button>}
          {/* The brokerage's turn */}
          {isOwner && row.status === 'change_requested' && row.submitted && <button type="button" disabled={busy} onClick={() => patch('approve', {}, 'Approved. The agent was told.')} className={primary}>Approve</button>}
          {isOwner && row.status === 'estimate' && closed && <button type="button" onClick={() => { setError(''); setDone(''); setMode('edit'); }} className={primary}>Confirm actual commission</button>}
          {isOwner && row.status === 'change_requested' && !row.submitted && <button type="button" onClick={() => { setError(''); setDone(''); setMode('edit'); }} className={primary}>Edit and send back</button>}
          {isOwner && row.status === 'accepted' && <button type="button" onClick={() => { setError(''); setDone(''); setMode('pay'); }} className={primary}>Mark paid</button>}
          {isOwner && row.status !== 'paid' && (
            <button type="button" onClick={() => { setError(''); setDone(''); setMode('edit'); }} className={ghost}>{row.status === 'accepted' ? 'Revise (agent agrees again)' : row.submitted ? 'Edit before approving' : row.status === 'estimate' ? 'Edit invoice' : 'Edit'}</button>
          )}
          {isOwner && row.status !== 'paid' && <button type="button" disabled={busy} onClick={() => window.confirm('Void this commission invoice? The agent will be told.') && patch('void', {}, 'Voided.')} className={`${btn} text-slate-400 hover:text-red-300`}>Void</button>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
        <button type="button" disabled={!agreed} onClick={() => openStatement(row.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the PDF'))} className={ghost}>Open PDF</button>
        <button type="button" disabled={!agreed} onClick={() => downloadStatement(row.id, row.statementNumber).catch((e) => setError(e instanceof Error ? e.message : 'Could not download the PDF'))} className={ghost}>Download PDF</button>
        {!agreed && row.status !== 'void' && <span className="text-[11px] text-slate-500">The PDF unlocks when you and {counterpart} both agree.</span>}
        <Link href={isOwner ? `/dashboard/collaborate/deals/${row.transactionId}` : `/dashboard/transactions/${row.transactionId}`} className="ml-auto text-xs text-blue-400 hover:text-blue-300">Open the deal →</Link>
      </div>
    </div>
  );
}

function Line({ label, value, strong, muted, total, note }: { label: React.ReactNode; value: string; strong?: boolean; muted?: boolean; total?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${total ? 'pt-2.5 mt-1 border-t border-white/10' : ''}`}>
      <span className={total ? 'text-slate-100 font-semibold' : 'text-slate-400'}>{label}</span>
      <span className="text-right">
        <span className={total ? 'text-lg font-semibold text-emerald-300' : strong ? 'font-semibold text-slate-100' : muted ? 'text-slate-300' : 'text-slate-100'}>{value}</span>
        {note && <span className="block text-[11px] text-slate-500">{note}</span>}
      </span>
    </div>
  );
}

// --- The agent's edit: their own lines and a note. The brokerage's terms and lines are shown but cannot be changed here. ---
function AgentEditor({ row, counterpart, busy, onCancel, onSave }: { row: PanelRow; counterpart: string; busy: boolean; onCancel: () => void; onSave: (action: string, body: Record<string, unknown>, ok: string) => void }) {
  const asking = row.status === 'proposed';
  const [mine, setMine] = useState<{ label: string; amount: string }[]>(row.deductions.filter((d) => d.by === 'agent').map((d) => ({ label: d.label, amount: String(d.amount) })));
  const [note, setNote] = useState(asking ? '' : row.changeNote ?? '');
  const theirs = row.deductions.filter((d) => d.by !== 'agent');
  const base = row.status === 'estimate' ? row.estimate : row;
  const share = base?.agentShare ?? null;
  const fees = [...theirs.map((d) => d.amount), ...mine.map((m) => Number(m.amount) || 0)].reduce((a, b) => a + b, 0);
  const net = share === null ? null : share - fees;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-800/40 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-100">{asking ? 'Ask for a change' : 'Your lines and note'}</p>
        <p className="text-xs text-slate-400">{asking ? `${counterpart} confirmed these amounts. Tell them what should change and add any line of your own, such as a referral fee.` : `Add a line of your own, such as a referral fee, and a note for ${counterpart}. The brokerage’s terms and fees can’t be changed here; mention it in the note.`}</p>
      </div>
      {theirs.length > 0 && (
        <div className="text-xs text-slate-400 space-y-0.5">
          {theirs.map((d, i) => <div key={i} className="flex justify-between"><span>{d.label} <span className="text-slate-500">(brokerage fee, locked)</span></span><span>−{money(d.amount)}</span></div>)}
        </div>
      )}
      <div>
        <p className="text-xs text-slate-400 mb-1">Your own lines (taken from your share)</p>
        {mine.map((m, i) => (
          <div key={i} className="flex gap-2 mb-1.5">
            <input value={m.label} placeholder="Referral fee" maxLength={60} onChange={(e) => setMine(mine.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={field} aria-label="Line name" />
            <input type="number" step="0.01" min="0" value={m.amount} placeholder="0.00" onChange={(e) => setMine(mine.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${field} w-32`} aria-label="Line amount" />
            <button type="button" onClick={() => setMine(mine.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 text-sm px-1" aria-label="Remove line">✕</button>
          </div>
        ))}
        {theirs.length + mine.length < 10 && <button type="button" onClick={() => setMine([...mine, { label: '', amount: '' }])} className="text-xs text-blue-400 hover:text-blue-300 font-medium">+ Add a line</button>}
      </div>
      {net !== null && <p className="text-sm text-slate-300">{row.status === 'estimate' ? 'Estimated take-home' : 'Take-home'} with these lines: <span className="text-emerald-300 font-semibold">{money(net)}</span></p>}
      <label className="block text-xs text-slate-400">{asking ? 'What should change?' : 'Note for your brokerage (optional)'}
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={3} className={`${field} mt-1`} placeholder={asking ? 'For example: the referral fee to ABC Realty is missing.' : 'For example: a $500 referral fee is owed on this deal.'} />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy || (asking && !note.trim())} onClick={() => onSave(asking ? 'request_change' : 'edit', { note, extraFees: mine.map((m) => ({ label: m.label, amount: m.amount })) }, asking ? `Sent to ${counterpart}.` : 'Saved. Your brokerage was told.')} className={primary}>{asking ? `Send to ${counterpart}` : 'Save'}</button>
        <button type="button" onClick={onCancel} className={`${btn} text-slate-300`}>Cancel</button>
      </div>
    </div>
  );
}

// --- The brokerage's edit: every figure on this invoice. Changes here are for this deal only; base terms live on the agent. ---
function OwnerEditor({ row, closed, busy, onCancel, onSave }: { row: PanelRow; closed: boolean; busy: boolean; onCancel: () => void; onSave: (body: Record<string, unknown>, ok: string) => void }) {
  const confirmed = row.status !== 'estimate';
  const [gross, setGross] = useState(confirmed && row.gross !== null ? String(row.gross) : '');
  const [rateType, setRateType] = useState<'percent' | 'flat'>(row.rate?.type ?? 'percent');
  const [rateValue, setRateValue] = useState(row.rate ? String(row.rate.value) : '');
  const [splitType, setSplitType] = useState<SplitType>(row.splitType);
  const [splitValue, setSplitValue] = useState(String(row.splitValue));
  const [fees, setFees] = useState<{ label: string; amount: string; by?: 'agent' }[]>(row.deductions.map((d) => ({ label: d.label, amount: String(d.amount), by: d.by })));
  const canGross = closed || confirmed;
  const sending = canGross && gross.trim() !== '';
  return (
    <form
      className="rounded-xl border border-white/10 bg-slate-800/40 p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body: Record<string, unknown> = { splitType, splitValue: Number(splitValue), deductions: fees.map((x) => ({ label: x.label, amount: x.amount, ...(x.by ? { by: x.by } : {}) })) };
        if (sending) body.gross = Number(gross);
        if (rateValue.trim() !== '') {
          body.commissionType = rateType;
          body.commissionValue = Number(rateValue);
        }
        onSave(body, sending ? 'Sent to the agent to review.' : 'Saved. The agent was told.');
      }}
    >
      <p className="text-sm font-semibold text-slate-100">Edit this invoice</p>
      {row.changeNote && <p className="text-xs text-orange-200">Agent’s note: {row.changeNote}</p>}
      {canGross ? (
        <label className="block text-xs text-slate-400">Commission your brokerage received ($), from the closing documents
          <input type="number" step="0.01" min="0" value={gross} onChange={(e) => setGross(e.target.value)} className={`${field} mt-1`} placeholder={row.estimate?.gross ? `Expected about ${money(row.estimate.gross)}. Leave blank to keep it an estimate` : 'Leave blank to keep it an estimate'} />
        </label>
      ) : (
        <p className="text-xs text-slate-400">The actual commission is confirmed once the deal closes. For now you can adjust the terms and fee lines below.</p>
      )}
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
        <p className="text-xs text-slate-400 mb-1">Fee lines taken from the agent’s share</p>
        {fees.map((x, i) => (
          <div key={i} className="flex gap-2 mb-1.5 items-center">
            <input value={x.label} placeholder="Transaction fee" maxLength={60} onChange={(e) => setFees(fees.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} className={field} aria-label="Fee name" />
            {x.by === 'agent' && <span className="shrink-0 text-[10px] uppercase tracking-wide text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1 py-px">agent</span>}
            <input type="number" step="0.01" min="0" value={x.amount} placeholder="0.00" onChange={(e) => setFees(fees.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} className={`${field} w-32`} aria-label="Fee amount" />
            <button type="button" onClick={() => setFees(fees.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 text-sm px-1" aria-label="Remove fee">✕</button>
          </div>
        ))}
        {fees.length < 10 && <button type="button" onClick={() => setFees([...fees, { label: '', amount: '' }])} className="text-xs text-blue-400 hover:text-blue-300 font-medium">+ Add a fee</button>}
      </div>
      <p className="text-[11px] text-slate-500">{sending ? 'Sending shows the confirmed amounts to the agent, who has to agree before it becomes final.' : 'Saving keeps this an estimate; the agent is told about the change.'} Changes apply to this invoice only.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}>{sending ? (confirmed ? 'Send revised invoice' : 'Confirm and send to agent') : 'Save changes'}</button>
        <button type="button" onClick={onCancel} className={`${btn} text-slate-300`}>Cancel</button>
      </div>
    </form>
  );
}

function PayForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (paidOn: string, note: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  return (
    <div className="rounded-xl border border-white/10 bg-slate-800/40 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-100">Record the payment</p>
      <label className="block text-xs text-slate-400">Agent paid on<input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className={`${field} mt-1`} /></label>
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder="Note (check number, ACH...)" className={field} />
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => onSave(paidOn, note)} className={primary}>Save</button>
        <button type="button" onClick={onCancel} className={`${btn} text-slate-300`}>Cancel</button>
      </div>
    </div>
  );
}
