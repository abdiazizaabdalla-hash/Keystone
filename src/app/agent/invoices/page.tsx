'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

interface AgentInvoice {
  id: string;
  invoice_number: string;
  amount_owed: number;
  due_date: string;
  invoice_date: string;
  paid: boolean;
  paid_at: string | null;
  paid_amount: number | null;
  refunded: boolean;
  refunded_at: string | null;
  transaction_id: string;
  transaction: { id: string; fileNumber: string; propertyAddress: string | null; tcLabel: string } | null;
}

export default function AgentInvoicesPage() {
  const router = useRouter();

  const [invoices, setInvoices] = useState<AgentInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pay-link state is per-invoice -- an agent can have more than one
  // unpaid invoice across different TCs/deals at once, so a single
  // shared "generating/url/error" triplet (like the per-transaction page
  // gets away with, since there's only ever one invoice in view there)
  // would have one invoice's link show up on another's row.
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [payUrls, setPayUrls] = useState<Record<string, string>>({});
  const [payErrors, setPayErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/agent/invoices');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load invoices');
        }
        const data = await res.json();
        setInvoices(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        console.error('Error loading agent invoices:', err);
        setError('Could not load your invoices. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router]);

  const handleLogout = () => {
    clearSession();
    router.push('/agent/login');
  };

  const handleGeneratePayLink = async (invoiceId: string) => {
    setGeneratingId(invoiceId);
    setPayErrors((prev) => ({ ...prev, [invoiceId]: '' }));
    try {
      const res = await authFetch(`/api/invoices/${invoiceId}/stripe-pay-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create payment link');
      setPayUrls((prev) => ({ ...prev, [invoiceId]: data.payUrl }));
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setPayErrors((prev) => ({
        ...prev,
        [invoiceId]: err instanceof Error ? err.message : 'Error creating pay link',
      }));
    } finally {
      setGeneratingId(null);
    }
  };

  const unpaid = invoices.filter((i) => !i.paid);
  const paid = invoices.filter((i) => i.paid);

  const renderRow = (invoice: AgentInvoice) => (
    <div
      key={invoice.id}
      className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {invoice.transaction ? (
            <Link
              href={`/agent/transactions/${invoice.transaction.id}`}
              className="text-slate-100 font-semibold hover:text-blue-300 transition truncate block"
            >
              {invoice.transaction.propertyAddress || invoice.transaction.fileNumber}
            </Link>
          ) : (
            <p className="text-slate-100 font-semibold">Deal no longer accessible</p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">
            {invoice.transaction ? `${invoice.transaction.tcLabel} · ` : ''}
            {invoice.invoice_number}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-slate-100 font-semibold">${invoice.amount_owed.toLocaleString()}</p>
          <p className={`text-xs mt-0.5 ${invoice.paid ? 'text-green-400' : 'text-blue-400'}`}>
            {invoice.paid ? 'Paid' : 'Unpaid'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
        <p className="text-xs text-slate-500">
          {invoice.paid && invoice.paid_at
            ? `Paid on ${formatDisplayDate(invoice.paid_at)}`
            : `Due ${formatDisplayDate(invoice.due_date)}`}
        </p>
        {!invoice.paid &&
          (payUrls[invoice.id] ? (
            <a
              href={payUrls[invoice.id]}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 border border-blue-500/50 text-blue-300 hover:text-blue-200 hover:border-blue-400 rounded-lg transition font-medium text-sm shrink-0"
            >
              Open Pay Online Link ↗
            </a>
          ) : (
            <button
              type="button"
              onClick={() => handleGeneratePayLink(invoice.id)}
              disabled={generatingId === invoice.id}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 shrink-0"
            >
              {generatingId === invoice.id ? 'Creating link…' : 'Pay Now'}
            </button>
          ))}
      </div>
      {payErrors[invoice.id] && <p className="text-red-400 text-xs mt-2">{payErrors[invoice.id]}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <img src="/relay-icon.png" alt="Relay TC" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-2xl font-display font-semibold text-slate-100">Invoices</h1>
              <p className="text-slate-400 text-sm mt-0.5">Every invoice across every deal and TC, in one place.</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 text-sm text-slate-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg hover:bg-red-900/20 transition"
          >
            Log out
          </button>
        </div>

        {loading ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : invoices.length === 0 ? (
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-8 text-center">
            <p className="text-slate-400 text-sm">
              No invoices yet -- they show up here once a TC generates one on a deal you&apos;re on.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {unpaid.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Unpaid ({unpaid.length})
                </p>
                <div className="space-y-3">{unpaid.map(renderRow)}</div>
              </div>
            )}
            {paid.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Paid</p>
                <div className="space-y-3">{paid.map(renderRow)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
