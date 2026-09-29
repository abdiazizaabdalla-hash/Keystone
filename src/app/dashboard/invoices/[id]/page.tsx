'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
  email: string | null;
  commission_percent: number;
  flat_fee: number;
}

interface Transaction {
  id: string;
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
  refunded?: boolean;
  refunded_at?: string | null;
  refunded_amount?: number | null;
  sent_at?: string | null;
  sent_to?: string | null;
  agent: Agent | null;
  transaction: Transaction | null;
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [showSendForm, setShowSendForm] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [dueDateInput, setDueDateInput] = useState('');
  const [isSavingDueDate, setIsSavingDueDate] = useState(false);
  const [isGeneratingPayLink, setIsGeneratingPayLink] = useState(false);
  const [payLinkError, setPayLinkError] = useState<string | null>(null);
  const [stripePayUrl, setStripePayUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoice();
  }, [resolvedParams.id]);

  const fetchInvoice = async () => {
    try {
      const response = await authFetch('/api/invoices');
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('Invalid response format');
      }

      const inv = data.find((i: Invoice) => i.id === resolvedParams.id);
      if (!inv) throw new Error('Invoice not found');
      
      setInvoice(inv);
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

  // Paid is all-or-nothing — a real estate closing payout isn't something
  // agents pay in installments, so there's no partial-amount entry here.
  // Marking paid always records the full invoiced amount.
  const handleMarkPaid = async () => {
    if (!invoice) return;

    try {
      setIsMarkingPaid(true);

      const response = await authFetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paid: true,
          paidAmount: invoice.amount_owed,
        }),
      });

      if (!response.ok) throw new Error('Failed to mark invoice as paid');

      const updated = await response.json();
      setInvoice(updated);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error: ' + msg);
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const handleMarkUnpaid = async () => {
    if (!invoice) return;
    
    try {
      setIsMarkingPaid(true);
      const response = await authFetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paid: false,
        }),
      });

      if (!response.ok) throw new Error('Failed to mark invoice as unpaid');
      
      const updated = await response.json();
      setInvoice(updated);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error: ' + msg);
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const handleSaveDueDate = async () => {
    if (!invoice || !dueDateInput) return;

    try {
      setIsSavingDueDate(true);
      const response = await authFetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          dueDate: dueDateInput,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update due date');
      }

      const updated = await response.json();
      setInvoice(updated);
      setIsEditingDueDate(false);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error: ' + msg);
    } finally {
      setIsSavingDueDate(false);
    }
  };

  const handleGeneratePayLink = async () => {
    if (!invoice) return;
    try {
      setIsGeneratingPayLink(true);
      setPayLinkError(null);
      const response = await authFetch(`/api/invoices/${invoice.id}/stripe-pay-link`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create pay link');
      // Not persisted on the invoice -- a Checkout Session URL is only
      // valid for 24 hours, so it's kept in local state and regenerated
      // on demand rather than saved to the database.
      setStripePayUrl(data.payUrl);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setPayLinkError(error instanceof Error ? error.message : 'Error creating pay link');
    } finally {
      setIsGeneratingPayLink(false);
    }
  };

  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    if (!confirm('Delete this invoice? This cannot be undone.')) return;

    try {
      setIsDeleting(true);
      const response = await authFetch(`/api/invoices?id=${invoice.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete invoice');
      }
      router.push('/dashboard/invoices');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error: ' + msg);
      setIsDeleting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!invoice) return;
    try {
      setIsDownloading(true);
      const response = await authFetch(`/api/invoices/${invoice.id}/pdf`);
      if (!response.ok) throw new Error('Failed to generate PDF');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoice_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error: ' + msg);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!invoice) return;
    try {
      setIsSending(true);
      setSendError(null);
      setSendResult(null);
      const response = await authFetch(`/api/invoices/${invoice.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: sendMessage }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send email');

      setInvoice((prev) => (prev ? { ...prev, sent_at: result.sent_at, sent_to: result.sent_to } : prev));
      setSendResult(
        `Sent to ${result.sent_to}${
          typeof result.documentsIncluded === 'number' ? ` with ${result.documentsIncluded} document(s)` : ''
        }.`
      );
      setShowSendForm(false);
      setSendMessage('');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      setSendError(msg);
    } finally {
      setIsSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard/invoices" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Invoices
          </Link>
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading invoice...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard/invoices" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Invoices
          </Link>
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Invoice</h2>
            <p className="text-red-200">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard/invoices" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Invoices
          </Link>
          <div className="text-center py-24">
            <h2 className="text-xl font-semibold text-slate-300 mb-2">Invoice not found</h2>
            <p className="text-slate-400">The invoice you're looking for doesn't exist.</p>
          </div>
        </div>
      </div>
    );
  }

  const isOverdue = new Date(invoice.due_date) < new Date() && !invoice.paid;

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <Link href="/dashboard/invoices" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Invoices
        </Link>

        {/* Main Card */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-4xl font-display font-semibold text-slate-100 mb-2">{invoice.invoice_number}</h1>
              <p className="text-slate-400">Agent Invoice</p>
            </div>
            <div className="text-right">
              <span className={`inline-block px-4 py-2 rounded-lg text-sm font-semibold ${
                invoice.refunded
                  ? 'bg-orange-500/20 text-orange-300'
                  : invoice.paid
                  ? 'bg-green-500/20 text-green-300'
                  : isOverdue
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-yellow-500/20 text-yellow-300'
              }`}>
                {invoice.refunded ? '↩ Refunded' : invoice.paid ? '✓ Paid' : isOverdue ? '⚠ Overdue' : 'Unpaid'}
              </span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-8 pt-8 border-t border-slate-600">
            {/* Invoice Details */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Invoice Details</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Invoice Number</p>
                  <p className="text-lg font-mono text-blue-400">{invoice.invoice_number}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Invoice Date</p>
                  <p className="text-slate-200">{new Date(invoice.invoice_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Due Date</p>
                  {isEditingDueDate ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={dueDateInput}
                        onChange={(e) => setDueDateInput(e.target.value)}
                        className="bg-slate-600 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSaveDueDate}
                        disabled={isSavingDueDate}
                        className="text-sm px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50"
                      >
                        {isSavingDueDate ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingDueDate(false)}
                        className="text-sm px-3 py-1.5 text-slate-400 hover:text-slate-200 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className={`text-slate-200 ${isOverdue ? 'text-red-400' : ''}`}>
                        {new Date(invoice.due_date).toLocaleDateString()}
                        {isOverdue && ' (Overdue)'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setDueDateInput(invoice.due_date.split('T')[0]);
                          setIsEditingDueDate(true);
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 transition"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Agent Information */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Agent Information</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white">
                    {(invoice.agent?.name || '?')[0]}
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 uppercase tracking-wider mb-1">Agent</p>
                    <p className="text-lg font-semibold text-slate-100">{invoice.agent?.name || 'Unknown Agent'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Brokerage</p>
                  <p className="text-slate-300">{invoice.agent?.brokerage || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Flat Fee</p>
                  <p className="text-slate-300">${(invoice.agent?.flat_fee ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Percentage Fee</p>
                  <p className="text-slate-300">{invoice.agent?.commission_percent ?? 0}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fee Calculation */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-6">Fee Calculation</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-4 border-b border-slate-600">
              <span className="text-slate-400">Purchase Price</span>
              <span className="text-lg font-semibold text-slate-100">
                ${(invoice.transaction?.purchase_price ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-slate-600">
              <span className="text-slate-400">Flat Fee</span>
              <span className="text-lg font-semibold text-slate-100">
                ${(invoice.agent?.flat_fee ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-slate-600">
              <span className="text-slate-400">Percentage Fee ({invoice.agent?.commission_percent ?? 0}% of purchase price)</span>
              <span className="text-lg font-semibold text-slate-100">
                ${(((invoice.transaction?.purchase_price ?? 0) * (invoice.agent?.commission_percent ?? 0)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center pt-4">
              <span className="text-slate-400 font-semibold">Total Amount Owed</span>
              <span className="text-2xl font-bold text-blue-400">
                ${invoice.amount_owed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Send to Agent */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-2">Send to Agent</h3>
          <p className="text-sm text-slate-400 mb-6">
            Download the invoice as a PDF, or email it to the agent along with every document uploaded for this transaction.
          </p>

          {invoice.sent_at && (
            <div className="bg-slate-600/40 border border-slate-600 rounded-lg p-4 mb-6 text-sm text-slate-300">
              Last sent to <span className="text-slate-100 font-medium">{invoice.sent_to}</span> on{' '}
              {new Date(invoice.sent_at).toLocaleString()}
            </div>
          )}

          {sendResult && (
            <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 mb-6 text-sm text-green-300">
              {sendResult}
            </div>
          )}

          {sendError && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6 text-sm text-red-200">
              {sendError}
            </div>
          )}

          {!invoice.agent?.email && (
            <div className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-6 text-sm text-blue-300">
              This agent has no email address on file — add one on the{' '}
              <Link href="/dashboard/agents" className="underline hover:text-blue-200">
                Agents page
              </Link>{' '}
              before emailing this invoice.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="px-4 py-3 border border-slate-600 hover:border-slate-500 text-slate-200 hover:text-slate-100 rounded-lg transition font-medium disabled:opacity-50"
            >
              {isDownloading ? 'Generating...' : 'Download PDF'}
            </button>
            <button
              onClick={() => setShowSendForm((v) => !v)}
              disabled={!invoice.agent?.email}
              className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Email Invoice &amp; Documents
            </button>
            {!invoice.paid && (
              stripePayUrl ? (
                <a
                  href={stripePayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-3 border border-blue-500/50 text-blue-300 hover:text-blue-200 hover:border-blue-400 rounded-lg transition font-medium"
                >
                  Open Pay Online Link ↗
                </a>
              ) : (
                <button
                  onClick={handleGeneratePayLink}
                  disabled={isGeneratingPayLink}
                  className="px-4 py-3 border border-blue-500/50 text-blue-300 hover:text-blue-200 hover:border-blue-400 rounded-lg transition font-medium disabled:opacity-50"
                >
                  {isGeneratingPayLink ? 'Creating link...' : 'Get Pay Online Link'}
                </button>
              )
            )}
          </div>
          {payLinkError && (
            <div className="mt-4 bg-red-900/30 border border-red-700 rounded-lg p-4 text-sm text-red-200">
              {payLinkError}
            </div>
          )}

          {showSendForm && (
            <div className="mt-6 space-y-4">
              <div>
                <label className="text-sm text-slate-400 block mb-2">Message (optional)</label>
                <textarea
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                  placeholder={`Attached is your invoice for ${invoice.transaction?.property_address || 'this transaction'}, along with the completed transaction documents.`}
                  rows={4}
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSendEmail}
                  disabled={isSending}
                  className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {isSending ? 'Sending...' : `Send to ${invoice.agent?.email}`}
                </button>
                <button
                  onClick={() => setShowSendForm(false)}
                  disabled={isSending}
                  className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Transaction Link */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-6">Related Transaction</h3>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">File Number</p>
              <p className="text-lg font-semibold text-slate-100">{invoice.transaction?.file_number || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Property Address</p>
              <p className="text-slate-300">{invoice.transaction?.property_address || 'N/A'}</p>
            </div>
            <Link
              href={`/dashboard/transactions/${invoice.transaction_id}`}
              className="inline-block mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
            >
              View Transaction
            </Link>
          </div>
        </div>

        {/* Payment Section */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-6">Payment Status</h3>
          
          {invoice.refunded ? (
            <div className="space-y-4">
              <div className="bg-orange-500/10 border border-orange-500/50 rounded-lg p-4">
                <p className="text-orange-400 font-semibold mb-2">↩ Payment Refunded</p>
                {invoice.refunded_at && (
                  <p className="text-orange-300 text-sm">Refunded on {new Date(invoice.refunded_at).toLocaleDateString()}</p>
                )}
                {invoice.refunded_amount != null && (
                  <p className="text-orange-300 text-sm">
                    Amount Refunded: ${invoice.refunded_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                )}
                <p className="text-orange-300/80 text-xs mt-2">
                  Issued from your Stripe account -- this is a read-only record, not something to undo here.
                </p>
              </div>
            </div>
          ) : invoice.paid ? (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                <p className="text-green-400 font-semibold mb-2">✓ Invoice Paid</p>
                <p className="text-green-300 text-sm">Paid on {new Date(invoice.paid_at!).toLocaleDateString()}</p>
                {invoice.paid_amount && (
                  <p className="text-green-300 text-sm">
                    Amount Received: ${invoice.paid_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <button
                onClick={handleMarkUnpaid}
                disabled={isMarkingPaid}
                className="w-full px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition font-medium disabled:opacity-50"
              >
                {isMarkingPaid ? 'Updating...' : 'Mark as Unpaid'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                onClick={handleMarkPaid}
                disabled={isMarkingPaid}
                className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold disabled:opacity-50"
              >
                {isMarkingPaid
                  ? 'Saving...'
                  : `Mark as Paid ($${invoice.amount_owed.toLocaleString(undefined, { maximumFractionDigits: 2 })})`}
              </button>
            </div>
          )}
        </div>

        {/* Danger Zone */}
        <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-8">
          <h2 className="text-xl font-bold text-red-300 mb-2">Danger Zone</h2>
          <p className="text-sm text-slate-400 mb-6">Permanently delete this invoice. This cannot be undone.</p>
          <button
            onClick={handleDeleteInvoice}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-900/40 hover:bg-red-900/70 border border-red-800 text-red-300 hover:text-red-100 rounded-lg transition font-medium disabled:opacity-50"
          >
            {isDeleting ? 'Deleting...' : 'Delete Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
