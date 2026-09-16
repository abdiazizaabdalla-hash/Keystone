'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
  commission_percent: number;
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
  agent: Agent;
  transaction: Transaction;
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paidAmount, setPaidAmount] = useState<string>('');

  useEffect(() => {
    fetchInvoice();
  }, [resolvedParams.id]);

  const fetchInvoice = async () => {
    try {
      const response = await fetch('/api/invoices');
      if (!response.ok) throw new Error('Failed to fetch invoices');
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('Invalid response format');
      }

      const inv = data.find((i: Invoice) => i.id === resolvedParams.id);
      if (!inv) throw new Error('Invoice not found');
      
      setInvoice(inv);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!invoice) return;
    
    try {
      setIsMarkingPaid(true);
      const amount = paidAmount ? parseFloat(paidAmount) : invoice.amount_owed;
      
      const response = await fetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paid: true,
          paidAmount: amount,
        }),
      });

      if (!response.ok) throw new Error('Failed to mark invoice as paid');
      
      const updated = await response.json();
      setInvoice(updated);
      setShowPaymentForm(false);
      setPaidAmount('');
    } catch (error) {
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
      const response = await fetch('/api/invoices', {
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
      const msg = error instanceof Error ? error.message : String(error);
      alert('Error: ' + msg);
    } finally {
      setIsMarkingPaid(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/invoices" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Invoices
          </Link>
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-amber-400 animate-spin mx-auto mb-4" />
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
          <Link href="/invoices" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
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
          <Link href="/invoices" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
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
        <Link href="/invoices" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Invoices
        </Link>

        {/* Main Card */}
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8 mb-8">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold text-slate-100 mb-2">{invoice.invoice_number}</h1>
              <p className="text-slate-400">Agent Invoice & Commission</p>
            </div>
            <div className="text-right">
              <span className={`inline-block px-4 py-2 rounded-lg text-sm font-semibold ${
                invoice.paid
                  ? 'bg-green-500/20 text-green-300'
                  : isOverdue
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-yellow-500/20 text-yellow-300'
              }`}>
                {invoice.paid ? '✓ Paid' : isOverdue ? '⚠ Overdue' : 'Unpaid'}
              </span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-8 pt-8 border-t border-slate-700">
            {/* Invoice Details */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Invoice Details</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Invoice Number</p>
                  <p className="text-lg font-mono text-amber-400">{invoice.invoice_number}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Invoice Date</p>
                  <p className="text-slate-200">{new Date(invoice.invoice_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Due Date</p>
                  <p className={`text-slate-200 ${isOverdue ? 'text-red-400' : ''}`}>
                    {new Date(invoice.due_date).toLocaleDateString()}
                    {isOverdue && ' (Overdue)'}
                  </p>
                </div>
              </div>
            </div>

            {/* Agent Information */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Agent Information</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center text-sm font-bold text-slate-950">
                    {invoice.agent.name[0]}
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 uppercase tracking-wider mb-1">Agent</p>
                    <p className="text-lg font-semibold text-slate-100">{invoice.agent.name}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Brokerage</p>
                  <p className="text-slate-300">{invoice.agent.brokerage || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Commission Rate</p>
                  <p className="text-slate-300">{invoice.agent.commission_percent}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Commission Calculation */}
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-6">Commission Calculation</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-4 border-b border-slate-700">
              <span className="text-slate-400">Purchase Price</span>
              <span className="text-lg font-semibold text-slate-100">
                ${invoice.transaction.purchase_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-slate-700">
              <span className="text-slate-400">Commission Rate</span>
              <span className="text-lg font-semibold text-slate-100">{invoice.agent.commission_percent}%</span>
            </div>
            <div className="flex justify-between items-center pt-4">
              <span className="text-slate-400 font-semibold">Commission Amount</span>
              <span className="text-2xl font-bold text-amber-400">
                ${invoice.amount_owed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Transaction Link */}
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-6">Related Transaction</h3>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">File Number</p>
              <p className="text-lg font-semibold text-slate-100">{invoice.transaction.file_number}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Property Address</p>
              <p className="text-slate-300">{invoice.transaction.property_address}</p>
            </div>
            <Link
              href={`/transactions/${invoice.transaction_id}`}
              className="inline-block mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
            >
              View Transaction
            </Link>
          </div>
        </div>

        {/* Payment Section */}
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8 mb-8">
          <h3 className="text-xl font-bold text-slate-100 mb-6">Payment Status</h3>
          
          {invoice.paid ? (
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
              {!showPaymentForm ? (
                <button
                  onClick={() => setShowPaymentForm(true)}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold"
                >
                  Record Payment
                </button>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Payment Amount</label>
                    <input
                      type="number"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      placeholder={invoice.amount_owed.toString()}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                      step="0.01"
                      min="0"
                    />
                    <p className="text-xs text-slate-500 mt-1">Leave blank to mark full amount as paid</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleMarkPaid}
                      disabled={isMarkingPaid}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-medium disabled:opacity-50"
                    >
                      {isMarkingPaid ? 'Saving...' : 'Confirm Payment'}
                    </button>
                    <button
                      onClick={() => setShowPaymentForm(false)}
                      disabled={isMarkingPaid}
                      className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition font-medium disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
