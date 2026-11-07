'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

interface Row {
  id: string;
  invoice_number: string;
  title: string;
  status: 'sent' | 'paid';
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  propertyAddress: string | null;
  fromName: string;
  total: number;
  payOnline: boolean;
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Invoices an agent sent to this coordinator (for example a referral fee on a deal). Shows nothing when there are none. */
export default function AgentBilledInvoices() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/workspace-invoices/received')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) return null;
  const owed = rows.filter((r) => r.status !== 'paid').reduce((s, r) => s + r.total, 0);

  const pay = async (r: Row) => {
    setBusy(r.id);
    setError('');
    try {
      const res = await authFetch(`/api/workspace-invoices/${r.id}/pay-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open the payment page');
      window.open(data.payUrl, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the payment page');
    } finally {
      setBusy(null);
    }
  };

  const pdf = async (r: Row) => {
    setBusy(r.id);
    setError('');
    try {
      const res = await authFetch(`/api/workspace-invoices/${r.id}/pdf`);
      if (!res.ok) throw new Error('Could not build the PDF');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Invoices from agents</p>
        <p className="text-xs text-slate-400">{owed > 0 ? `You owe ${money(owed)}` : 'All paid'}</p>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-100 truncate">{r.title || r.invoice_number}</p>
                <p className="text-xs text-slate-500 truncate">
                  {r.invoice_number} · from {r.fromName}
                  {r.propertyAddress ? ` · ${r.propertyAddress}` : ''} · {r.status === 'paid' && r.paid_at ? `paid ${formatDisplayDate(r.paid_at)}` : r.due_date ? `due ${formatDisplayDate(r.due_date)}` : 'due on receipt'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${r.status === 'paid' ? 'bg-green-500/10 text-green-300 border-green-500/40' : 'bg-amber-500/10 text-amber-300 border-amber-500/40'}`}>{r.status === 'paid' ? 'Paid' : 'Due'}</span>
                <span className="font-semibold text-slate-100">{money(r.total)}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
              <button type="button" onClick={() => pdf(r)} disabled={busy === r.id} className="px-3 py-1.5 border border-slate-500/50 text-slate-300 hover:text-slate-100 hover:border-slate-400 rounded-lg transition text-sm disabled:opacity-50">
                Download PDF
              </button>
              {r.status !== 'paid' && r.payOnline && (
                <button type="button" onClick={() => pay(r)} disabled={busy === r.id} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                  {busy === r.id ? 'Opening…' : 'Pay online'}
                </button>
              )}
            </div>
            {r.status !== 'paid' && !r.payOnline && <p className="text-xs text-slate-500 mt-2 text-right">{r.fromName} hasn&apos;t set up online payments. Reply to their email to arrange payment.</p>}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
    </div>
  );
}
