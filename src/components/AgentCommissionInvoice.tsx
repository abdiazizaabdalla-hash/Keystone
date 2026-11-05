'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { openStatement } from '@/lib/commissionClient';
import type { SplitType } from '@/lib/commissionMath';

// The commission section of an agent's deal when they are in a brokerage. Their brokerage's commission statement starts as an
// estimate (no amounts) built from the terms the brokerage set for them. The brokerage owner confirms the actual commission from
// the closing documents; the agent reviews it in the Commission box. This is the brokerage's commission accounting, separate from
// anything billed through Relay Invoices (a coordinator, a client, anyone else).

const money = (n: number | null) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface View { id: string; statementNumber: string; status: 'estimate' | 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void'; submitted?: boolean; gross: number | null; agentNet: number | null; brokerageNet: number | null; paidOn: string | null; splitType: SplitType; splitValue: number; estimate?: { gross: number | null; agentNet: number | null } | null }
interface Data { role: 'agent' | 'owner' | null; awaitingTerms?: boolean; canInvoice?: boolean; brokerage?: { name: string; email: string | null }; dealClosed?: boolean; commission: View | null }

export default function AgentCommissionInvoice({ transactionId, hasCoordinator }: { transactionId: string; purchasePrice?: number | null; hasCoordinator: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/commissions?transaction=${encodeURIComponent(transactionId)}`);
      setData(res.ok ? await res.json() : { role: null, commission: null });
    } catch {
      setData({ role: null, commission: null });
    }
  }, [transactionId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const other = (
    <p className="text-xs text-slate-500 mt-4">
      Billing someone else for this deal, like a coordinator or a client? That is a separate invoice:{' '}
      <Link href={hasCoordinator ? `/dashboard/invoices?transactionId=${transactionId}` : '/dashboard/invoices?new=1'} className="text-blue-400 hover:text-blue-300">create an invoice</Link>. Your brokerage commission invoice is listed in <Link href="/dashboard/invoices" className="text-blue-400 hover:text-blue-300">Invoices</Link> too, but it is not part of that billing.
    </p>
  );

  if (data === null) return <p className="text-sm text-slate-500">Loading…</p>;
  const c = data.commission;

  if (c && c.status !== 'void') {
    const estimate = c.status === 'estimate';
    const state =
      estimate ? { text: data.dealClosed ? 'Estimate. This deal closed, and your brokerage will confirm the actual commission from the closing documents. No amount counts until then.' : 'Sent. Your brokerage confirms the actual commission from the closing documents when the deal closes. No amount counts until then.', cls: 'text-amber-300' }
      : c.status === 'paid' ? { text: `Your brokerage paid you${c.paidOn ? ` on ${c.paidOn}` : ''}.`, cls: 'text-emerald-300' }
      : c.status === 'accepted' ? { text: 'You agreed. Your brokerage pays you, then records it as paid here.', cls: 'text-emerald-300' }
      : c.status === 'proposed' ? { text: 'Your brokerage confirmed the commission. Review it in the Commission box and agree or ask for a change.', cls: 'text-amber-300' }
      : c.submitted ? { text: 'Sent. Waiting for your brokerage to approve it.', cls: 'text-blue-300' }
      : { text: 'You asked for a change. Waiting for your brokerage.', cls: 'text-orange-300' };
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-slate-100 font-semibold">
              {c.statementNumber} · {estimate ? (c.estimate?.agentNet ? `Estimate, about ${money(c.estimate.agentNet)} to you` : 'Estimate, no amount yet') : `You take home ${money(c.agentNet)}`}
            </p>
            {!estimate && <p className="text-xs text-slate-400 mt-0.5">Your brokerage received {money(c.gross)} in commission on this deal. The rest is its share and any fees.</p>}
            <p className={`text-sm mt-0.5 ${state.cls}`}>{state.text}</p>
          </div>
          {!estimate && <button type="button" onClick={() => openStatement(c.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not open the statement'))} className="shrink-0 px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg">View statement</button>}
        </div>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {other}
      </div>
    );
  }

  if (data.canInvoice && data.brokerage) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-300 max-w-xl">Send {data.brokerage.name} your commission invoice for this deal. It is filled in from the terms they set for you: sale price, commission rate, split and fees. They confirm the actual amount from the closing documents.</p>
        <Link href={`/dashboard/invoices?commissionFor=${transactionId}`} className="shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">Send commission invoice</Link>
      </div>
    );
  }

  if (data.awaitingTerms && data.brokerage) {
    return (
      <div>
        <p className="text-sm text-slate-300">{data.brokerage.name} has not set your commission terms yet, so there is no commission estimate on this deal. When they set your split and commission rate, it appears here.</p>
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
