'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

interface Detail {
  id: string;
  invoiceNumber: string;
  amountOwed: number;
  invoiceDate: string;
  dueDate: string;
  sentAt: string | null;
  paid: boolean;
  paidAt: string | null;
  paidAmount: number | null;
  refunded: boolean;
  refundedAmount: number | null;
  payOnline: boolean;
  billedBy: { name: string; email: string | null };
  deal: { id: string; fileNumber: string; propertyAddress: string | null; purchasePrice: number; closingDate: string | null; status: string | null };
  fee: { flatFee: number; percent: number; percentAmount: number; total: number };
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6';
const label = 'text-xs text-slate-500 uppercase tracking-wider mb-1';

// What a coordinator billed this agent on one of their deals: the same details the coordinator sees, from the payer's side.
export default function ReceivedInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [inv, setInv] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'pay' | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/agent/invoices/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Could not load this invoice');
        setInv(data);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load this invoice'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const download = async () => {
    if (!inv) return;
    setBusy('pdf');
    setActionError('');
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/pdf`);
      if (!res.ok) throw new Error('Could not build the PDF');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not build the PDF');
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (!inv) return;
    setBusy('pay');
    setActionError('');
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/stripe-pay-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open the payment page');
      window.open(data.payUrl, '_blank', 'noopener');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not open the payment page');
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="p-4 md:p-10 max-w-3xl mx-auto">
        <Link href="/dashboard/invoices" className="text-sm text-slate-400 hover:text-slate-200">← All invoices</Link>
        <p className="mt-6 text-red-300">{error}</p>
      </div>
    );
  }
  if (!inv) return <div className="p-10 text-slate-400">Loading…</div>;

  const status = inv.refunded ? 'Refunded' : inv.paid ? 'Paid' : 'Due';
  const statusCls = inv.refunded ? 'bg-slate-500/10 text-slate-300 border-slate-500/40' : inv.paid ? 'bg-green-500/10 text-green-300 border-green-500/40' : 'bg-amber-500/10 text-amber-300 border-amber-500/40';
  const steps = [
    { label: 'Invoice created', date: inv.invoiceDate, done: true },
    { label: `Sent by ${inv.billedBy.name}`, date: inv.sentAt, done: !!inv.sentAt },
    { label: 'Paid', date: inv.paidAt, done: inv.paid },
  ];

  return (
    <div className="p-4 md:p-10 max-w-3xl mx-auto space-y-5">
      <Link href="/dashboard/invoices" className="text-sm text-slate-400 hover:text-slate-200">← All invoices</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-slate-100">{inv.invoiceNumber}</h1>
          <p className="text-slate-400 mt-1">From {inv.billedBy.name}{inv.billedBy.email ? ` · ${inv.billedBy.email}` : ''}</p>
        </div>
        <div className="text-right">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${statusCls}`}>{status}</span>
          <p className="text-3xl font-semibold text-slate-100 mt-2">{money(inv.amountOwed)}</p>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Invoice details</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><p className={label}>Invoice number</p><p className="text-slate-100">{inv.invoiceNumber}</p></div>
          <div><p className={label}>Invoice date</p><p className="text-slate-100">{formatDisplayDate(inv.invoiceDate)}</p></div>
          <div><p className={label}>Due date</p><p className="text-slate-100">{formatDisplayDate(inv.dueDate)}</p></div>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">How this was calculated</p>
        <div className="space-y-2 text-sm">
          {inv.fee.flatFee > 0 && (
            <div className="flex justify-between"><span className="text-slate-300">Transaction coordination fee (flat)</span><span className="text-slate-100">{money(inv.fee.flatFee)}</span></div>
          )}
          {inv.fee.percent > 0 && (
            <div className="flex justify-between"><span className="text-slate-300">{inv.fee.percent}% of the {money(inv.deal.purchasePrice)} purchase price</span><span className="text-slate-100">{money(inv.fee.percentAmount)}</span></div>
          )}
          {inv.fee.flatFee === 0 && inv.fee.percent === 0 && <p className="text-slate-400">No fee terms are on file for this invoice.</p>}
          <div className="flex justify-between border-t border-white/10 pt-2 font-semibold"><span className="text-slate-200">Total due</span><span className="text-slate-100">{money(inv.amountOwed)}</span></div>
        </div>
        {Math.abs(inv.fee.total - inv.amountOwed) > 0.01 && (
          <p className="text-xs text-slate-500 mt-3">The fee terms have changed since this invoice was made, so the total above is what was billed.</p>
        )}
      </div>

      <div className={card}>
        <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Deal</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className={label}>Property</p>
            <Link href={`/dashboard/transactions/${inv.deal.id}`} className="text-blue-300 hover:text-blue-200">{inv.deal.propertyAddress || inv.deal.fileNumber}</Link>
          </div>
          <div><p className={label}>File number</p><p className="text-slate-100">{inv.deal.fileNumber || '—'}</p></div>
          <div><p className={label}>Purchase price</p><p className="text-slate-100">{money(inv.deal.purchasePrice)}</p></div>
          <div><p className={label}>Closing</p><p className="text-slate-100">{inv.deal.closingDate ? formatDisplayDate(inv.deal.closingDate) : '—'}{inv.deal.status ? ` · ${inv.deal.status}` : ''}</p></div>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Payment status</p>
        <ol className="space-y-3 mb-5">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              <span className={`h-5 w-5 rounded-full border flex items-center justify-center text-[11px] ${s.done ? 'bg-green-500/20 border-green-500/50 text-green-300' : 'border-white/20 text-transparent'}`}>✓</span>
              <span className={s.done ? 'text-slate-100' : 'text-slate-500'}>{s.label}</span>
              {s.done && s.date && <span className="text-xs text-slate-500">{formatDisplayDate(s.date)}</span>}
            </li>
          ))}
        </ol>
        {inv.paid && <p className="text-sm text-green-300 mb-4">Paid{inv.paidAmount ? ` ${money(Number(inv.paidAmount))}` : ''}{inv.paidAt ? ` on ${formatDisplayDate(inv.paidAt)}` : ''}.</p>}
        {inv.refunded && <p className="text-sm text-slate-300 mb-4">Refunded{inv.refundedAmount ? ` ${money(Number(inv.refundedAmount))}` : ''}.</p>}
        <div className="flex flex-wrap gap-2">
          {!inv.paid && inv.payOnline && (
            <button type="button" onClick={pay} disabled={busy !== null} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
              {busy === 'pay' ? 'Opening…' : 'Pay online'}
            </button>
          )}
          <button type="button" onClick={download} disabled={busy !== null} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 text-sm rounded-lg transition disabled:opacity-50">
            {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
        {!inv.paid && !inv.payOnline && <p className="text-xs text-slate-500 mt-3">{inv.billedBy.name} hasn&apos;t set up online payments, so they will let you know how to pay. Once they mark it paid, it shows here.</p>}
        {actionError && <p className="text-sm text-red-300 mt-3">{actionError}</p>}
      </div>
    </div>
  );
}
