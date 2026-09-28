'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface Agent {
  name: string;
  brokerage: string;
  commission_percent: number;
  flat_fee: number;
}

interface Transaction {
  file_number: string;
  property_address: string;
  purchase_price: number;
}

interface Invoice {
  id: string;
  agent_id: string;
  transaction_id: string;
  amount_owed: number;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  paid: boolean;
  paid_at?: string;
  paid_amount?: number;
  agent: Agent | null;
  transaction: Transaction | null;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingDueDateId, setEditingDueDateId] = useState<string | null>(null);
  const [dueDateDraft, setDueDateDraft] = useState('');
  const [savingDueDateId, setSavingDueDateId] = useState<string | null>(null);
  const [dueDateError, setDueDateError] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices();
  }, []);

  useEffect(() => {
    filterInvoices();
  }, [invoices, filterStatus, searchTerm]);

  const fetchInvoices = async () => {
    try {
      const response = await authFetch('/api/invoices');
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const data = await response.json();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const filterInvoices = () => {
    let result = invoices;

    // Filter by status
    if (filterStatus === 'paid') {
      result = result.filter((inv) => inv.paid);
    } else if (filterStatus === 'unpaid') {
      result = result.filter((inv) => !inv.paid);
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(term) ||
          (inv.agent?.name || '').toLowerCase().includes(term) ||
          (inv.transaction?.file_number || '').toLowerCase().includes(term)
      );
    }

    setFilteredInvoices(result);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this invoice? This cannot be undone.')) return;

    try {
      setDeletingId(id);
      const response = await authFetch(`/api/invoices?id=${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete invoice');
      }
      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      alert(error instanceof Error ? error.message : 'Failed to delete invoice');
    } finally {
      setDeletingId(null);
    }
  };

  const startEditingDueDate = (invoice: Invoice) => {
    setDueDateError(null);
    setEditingDueDateId(invoice.id);
    setDueDateDraft(invoice.due_date ? invoice.due_date.slice(0, 10) : '');
  };

  const cancelEditingDueDate = () => {
    setEditingDueDateId(null);
    setDueDateDraft('');
    setDueDateError(null);
  };

  const saveDueDate = async (invoiceId: string) => {
    if (!dueDateDraft) {
      setDueDateError('Please choose a date');
      return;
    }
    try {
      setSavingDueDateId(invoiceId);
      setDueDateError(null);
      const response = await authFetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, dueDate: dueDateDraft }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to update due date');
      }
      const updated = await response.json();
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === invoiceId ? { ...inv, due_date: updated.due_date ?? dueDateDraft } : inv))
      );
      setEditingDueDateId(null);
      setDueDateDraft('');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setDueDateError(error instanceof Error ? error.message : 'Failed to update due date');
    } finally {
      setSavingDueDateId(null);
    }
  };

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount_owed, 0);
  const paidAmount = invoices
    .filter((inv) => inv.paid)
    .reduce((sum, inv) => sum + (inv.paid_amount || 0), 0);
  const outstandingAmount = invoices
    .filter((inv) => !inv.paid)
    .reduce((sum, inv) => sum + inv.amount_owed, 0);

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading invoices...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-display font-semibold text-slate-100 mb-2">Invoices</h1>
          <p className="text-slate-400">Manage and track agent fee invoices</p>
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Total Amount */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Total Invoiced</div>
            <div className="text-3xl font-bold text-blue-400">${totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-slate-500 mt-2">{invoices.length} invoices</div>
          </div>

          {/* Outstanding */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Outstanding</div>
            <div className="text-3xl font-bold text-red-400">${outstandingAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-slate-500 mt-2">{invoices.filter((inv) => !inv.paid).length} unpaid</div>
          </div>

          {/* Received */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Received</div>
            <div className="text-3xl font-bold text-green-400">${paidAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-slate-500 mt-2">{invoices.filter((inv) => inv.paid).length} paid</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 mb-8">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Search */}
            <div>
              <label className="text-sm text-slate-400 block mb-2">Search</label>
              <input
                type="text"
                placeholder="Invoice #, Agent, File #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Status Filter */}
            <div>
              <label className="text-sm text-slate-400 block mb-2">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Invoices</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Invoices</h2>
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {filteredInvoices.length === 0 ? (
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No invoices found</h3>
            <p className="text-slate-400">Create a deal and close it to auto-generate an invoice</p>
          </div>
        ) : (
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-600 bg-slate-800/50">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Invoice #</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-600">
                  {filteredInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-600/30 transition">
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/invoices/${invoice.id}`} className="font-mono text-blue-400 hover:text-blue-300 transition">
                          {invoice.invoice_number}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-slate-300">{invoice.agent?.name || 'Unknown Agent'}</td>
                      <td className="px-6 py-4 text-slate-400 text-sm max-w-xs truncate">{invoice.transaction?.file_number || 'N/A'}</td>
                      <td className="px-6 py-4 text-slate-100 font-semibold">
                        ${invoice.amount_owed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-sm">
                        {editingDueDateId === invoice.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={dueDateDraft}
                              onChange={(e) => setDueDateDraft(e.target.value)}
                              className="bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-slate-100 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              onClick={() => saveDueDate(invoice.id)}
                              disabled={savingDueDateId === invoice.id}
                              className="text-blue-400 hover:text-blue-300 text-xs font-semibold transition disabled:opacity-50"
                            >
                              {savingDueDateId === invoice.id ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEditingDueDate}
                              disabled={savingDueDateId === invoice.id}
                              className="text-slate-500 hover:text-slate-300 text-xs transition disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            {dueDateError && <span className="text-red-400 text-xs">{dueDateError}</span>}
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingDueDate(invoice)}
                            className="hover:text-blue-300 transition inline-flex items-center gap-1.5 group"
                            title="Edit due date"
                          >
                            {new Date(invoice.due_date).toLocaleDateString()}
                            <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                          invoice.paid
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-yellow-500/20 text-yellow-300'
                        }`}>
                          {invoice.paid ? 'Paid' : 'Unpaid'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/dashboard/invoices/${invoice.id}`}
                            className="text-slate-400 hover:text-slate-200 transition inline-flex items-center gap-2"
                          >
                            View
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 110-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                          </Link>
                          <button
                            onClick={() => handleDelete(invoice.id)}
                            disabled={deletingId === invoice.id}
                            className="text-slate-500 hover:text-red-400 text-sm font-medium transition disabled:opacity-50"
                            title="Delete invoice"
                          >
                            {deletingId === invoice.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
