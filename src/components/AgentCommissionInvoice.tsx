'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import { computeSplit, type SplitType } from '@/lib/commissionMath';

// The Invoice section of an agent's deal when they are in a brokerage. The commission invoice is already filled in from the
// brokerage's default split for them: the agent presses Generate, the brokerage approves or edits it, then it is paid (through
// Relay once that is switched on) or marked paid. Anything else the agent bills goes through Invoices.

const RATE = 3; // percent of the sale price used as the starting estimate; the agent can change the amount
const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const splitText = (t: SplitType, v: number) => (t === 'percent' ? `You keep ${v}%` : t === 'flat_agent' ? `You get ${money(v)}` : `Brokerage fee ${money(v)}, you keep the rest`);

interface View { id: string; statementNumber: string; status: 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void'; submitted?: boolean; gross: number; agentNet: number; brokerageNet: number; paidOn: string | null; splitType: SplitType; splitValue: number }
interface Data { role: 'agent' | 'owner' | null; canGenerate?: boolean; brokerage?: { name: string; email: string | null }; defaultSplit?: { type: SplitType; value: number } | null; purchasePrice?: number | null; commission: View | null }

export default function AgentCommissionInvoice({ transactionId, purchasePrice, hasCoordinator }: { transactionId: string; purchasePrice: number | null; hasCoordinator: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [gross, setGross] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/commissions?transaction=${encodeURIComponent(transactionId)}`);
      const json: Data = res.ok ? await res.json() : { role: null, commission: null };
      setData(json);
      setGross((g) => (g !== '' ? g : json.canGenerate && (json.purchasePrice ?? purchasePrice) ? String(Math.round(((json.purchasePrice ?? purchasePrice ?? 0) * RATE) / 100)) : g));
    } catch {
      setData({ role: null, commission: null });
    }
  }, [transactionId, purchasePrice]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const preview = useMemo(() => {
    const split = data?.defaultSplit;
    const g = Number(gross);
    if (!split || !(g > 0)) return null;
    try {
      const r = computeSplit({ gross: g, splitType: split.type, splitValue: split.value, deductions: [] });
      return { agentNet: r.agentNetCents / 100, brokerageNet: r.brokerageNetCents / 100 };
    } catch {
      return null;
    }
  }, [data, gross]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch('/api/commissions/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId, gross: Number(gross) }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not generate the invoice');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the invoice');
    } finally {
      setBusy(false);
    }
  };

  const other = (
    <p className="text-xs text-slate-500 mt-4">
      Billing someone else for this deal?{' '}
      <Link href={hasCoordinator ? `/dashboard/invoices?transactionId=${transactionId}` : '/dashboard/invoices?new=1'} className="text-blue-400 hover:text-blue-300">Create another invoice</Link>
    </p>
  );

  if (data === null) return <p className="text-sm text-slate-500">Loading…</p>;
  const c = data.commission;

  if (c && c.status !== 'void') {
    const state =
      c.status === 'paid' ? { text: `Paid${c.paidOn ? ` on ${c.paidOn}` : ''}.`, cls: 'text-emerald-300' }
      : c.status === 'accepted' ? { text: 'Approved by your brokerage. They will pay you or mark it paid here.', cls: 'text-emerald-300' }
      : c.status === 'proposed' ? { text: 'Your brokerage changed the split. Review it in the Commission box and agree or ask for a change.', cls: 'text-amber-300' }
      : c.submitted ? { text: 'Sent. Waiting for your brokerage to approve it.', cls: 'text-blue-300' }
      : { text: 'You asked for a change. Waiting for your brokerage.', cls: 'text-orange-300' };
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-slate-100 font-semibold">{c.statementNumber} · {money(c.agentNet)} to you</p>
            <p className={`text-sm mt-0.5 ${state.cls}`}>{state.text}</p>
          </div>
          <button type="button" onClick={() => openStatement(c.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="shrink-0 px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg">View invoice</button>
        </div>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {other}
      </div>
    );
  }

  if (data.canGenerate && data.brokerage) {
    return (
      <div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Billed to</p>
            <p className="text-slate-100 font-medium">{data.brokerage.name}</p>
            {data.brokerage.email && <p className="text-xs text-slate-400">{data.brokerage.email}</p>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Your split</p>
            <p className="text-slate-100 font-medium">{data.defaultSplit ? splitText(data.defaultSplit.type, data.defaultSplit.value) : 'Not set by your brokerage yet'}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400 block">
            Gross commission on this deal
            <span className="mt-1 flex items-center gap-1">
              <span className="text-slate-300">$</span>
              <input type="number" min="0" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} className="w-36 px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100" aria-label="Gross commission" />
            </span>
          </label>
          {preview && <p className="text-sm text-slate-300 pb-1.5">You receive <span className="text-emerald-300 font-semibold">{money(preview.agentNet)}</span>, brokerage keeps {money(preview.brokerageNet)}</p>}
        </div>
        <p className="text-xs text-slate-500 mt-2">Starts at {RATE}% of the sale price as an estimate. Change it if this deal’s commission is different; your brokerage reviews it before it counts.</p>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={busy || !preview} onClick={generate} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">{busy ? 'Generating…' : 'Generate invoice'}</button>
          {!data.defaultSplit && <span className="text-xs text-amber-300">Your brokerage has not set your split yet, so they need to do that first.</span>}
        </div>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {other}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-sm text-slate-400 max-w-xl">
        {hasCoordinator ? 'A coordinator is on this deal, so the invoice is attached to it and starts addressed to them.' : 'Create an invoice for this deal and send it to anyone. Add a coordinator to this deal and the invoice attaches to it automatically.'}
      </p>
      <Link href={hasCoordinator ? `/dashboard/invoices?transactionId=${transactionId}` : '/dashboard/invoices?new=1'} className="shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">Generate invoice</Link>
    </div>
  );
}
