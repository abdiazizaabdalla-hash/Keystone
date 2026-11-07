'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

export interface CoordinatorInvoice {
  id: string;
  invoice_number: string;
  amount_owed: number;
  due_date: string;
  invoice_date: string;
  paid: boolean;
  paid_at: string | null;
  refunded: boolean;
  transaction_id: string;
  payOnline: boolean;
  transaction: { id: string; fileNumber: string; propertyAddress: string | null; tcLabel: string } | null;
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the agent owes their coordinators, for deals the coordinator is on: pay online when the coordinator offers it, or download the PDF. */
export function coordinatorOwed(list: CoordinatorInvoice[]): number {
  return list.filter((i) => !i.paid && !i.refunded).reduce((s, i) => s + (i.amount_owed || 0), 0);
}

export default function CoordinatorInvoiceList({ invoices, detailHref }: { invoices: CoordinatorInvoice[]; detailHref?: (invoiceId: string) => string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payUrls, setPayUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const payLink = async (id: string) => {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: '' }));
    try {
      const res = await authFetch(`/api/invoices/${id}/stripe-pay-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the payment link');
      setPayUrls((u) => ({ ...u, [id]: data.payUrl }));
      window.open(data.payUrl, '_blank', 'noopener');
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : 'Could not create the payment link' }));
    } finally {
      setBusyId(null);
    }
  };

  const pdf = async (inv: CoordinatorInvoice) => {
    setBusyId(inv.id);
    setErrors((e) => ({ ...e, [inv.id]: '' }));
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/pdf`);
      if (!res.ok) throw new Error('Could not build the PDF');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setErrors((e) => ({ ...e, [inv.id]: err instanceof Error ? err.message : 'Could not build the PDF' }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      {invoices.map((inv) => {
        const tc = inv.transaction?.tcLabel || 'Your coordinator';
        return (
          <div
            key={inv.id}
            onClick={detailHref ? () => router.push(detailHref(inv.id)) : undefined}
            className={`bg-white/5 border border-white/10 rounded-2xl p-4 ${detailHref ? 'cursor-pointer hover:border-white/25 transition' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                {detailHref ? (
                  <Link href={detailHref(inv.id)} className="font-semibold text-slate-100 hover:text-blue-300 transition truncate block">
                    {inv.transaction?.propertyAddress || inv.transaction?.fileNumber || inv.invoice_number}
                  </Link>
                ) : (
                  <p className="font-semibold text-slate-100 truncate">{inv.transaction?.propertyAddress || inv.transaction?.fileNumber || inv.invoice_number}</p>
                )}
                <p className="text-xs text-slate-500 truncate">
                  {inv.invoice_number} · from {tc} ·{' '}
                  {inv.paid && inv.paid_at ? `paid ${formatDisplayDate(inv.paid_at)}` : `due ${formatDisplayDate(inv.due_date)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    inv.refunded ? 'bg-slate-500/10 text-slate-300 border-slate-500/40' : inv.paid ? 'bg-green-500/10 text-green-300 border-green-500/40' : 'bg-amber-500/10 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {inv.refunded ? 'Refunded' : inv.paid ? 'Paid' : 'Due'}
                </span>
                <span className="font-semibold text-slate-100">{money(inv.amount_owed)}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => pdf(inv)}
                disabled={busyId === inv.id}
                className="px-3 py-1.5 border border-slate-500/50 text-slate-300 hover:text-slate-100 hover:border-slate-400 rounded-lg transition text-sm disabled:opacity-50"
              >
                Download PDF
              </button>
              {detailHref && (
                <Link href={detailHref(inv.id)} className="px-3 py-1.5 border border-slate-500/50 text-slate-300 hover:text-slate-100 hover:border-slate-400 rounded-lg transition text-sm">
                  View details
                </Link>
              )}
              {!inv.paid && inv.payOnline && (
                <button
                  type="button"
                  onClick={() => (payUrls[inv.id] ? window.open(payUrls[inv.id], '_blank', 'noopener') : payLink(inv.id))}
                  disabled={busyId === inv.id}
                  className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {busyId === inv.id ? 'Opening…' : 'Pay online'}
                </button>
              )}
            </div>
            {!inv.paid && !inv.payOnline && <p className="text-xs text-slate-500 mt-2 text-right">{tc} will let you know how to pay. Once they mark it paid, it shows here.</p>}
            {errors[inv.id] && <p className="text-red-400 text-xs mt-2 text-right">{errors[inv.id]}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** On the agent's own deal: the coordinator's invoice for it, if there is one. Renders nothing otherwise. */
export function DealCoordinatorInvoices({ transactionId }: { transactionId: string }) {
  const [invoices, setInvoices] = useState<CoordinatorInvoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/agent/invoices?transactionId=${encodeURIComponent(transactionId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setInvoices(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [transactionId]);
  if (invoices.length === 0) return null;
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Invoice from your coordinator</p>
      <CoordinatorInvoiceList invoices={invoices} detailHref={(invoiceId) => `/dashboard/invoices/received/${invoiceId}`} />
    </div>
  );
}
