'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface Transaction {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  closing_date: string | null;
  acceptance_date: string | null;
  created_at: string;
  updated_at: string;
  /** Earliest incomplete task's due_date across this deal's checklist, or null. */
  next_due_date?: string | null;
  /** How many incomplete tasks on this deal are already past their due_date. */
  overdue_count?: number;
}

interface Agent {
  id: string;
  name: string;
  flat_fee: number;
  commission_percent: number;
}

interface Invoice {
  id: string;
  agent_id: string;
  transaction_id: string;
  amount_owed: number;
  invoice_date: string;
  due_date: string;
  paid: boolean;
  paid_at: string | null;
  refunded?: boolean;
  refunded_amount?: number | null;
}

const formatCurrency = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Same visual logic as src/app/dashboard/transactions/page.tsx, duplicated
// here rather than imported so this page can't accidentally change
// behavior on that already-working page (or vice versa).
const getDueBadge = (tx: Transaction) => {
  if (tx.status === 'Closed') {
    return <span className="text-xs text-slate-600">—</span>;
  }
  if (tx.overdue_count && tx.overdue_count > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/30 border border-red-700 text-red-400 whitespace-nowrap">
        {tx.overdue_count} overdue
      </span>
    );
  }
  if (!tx.next_due_date) {
    return <span className="text-xs text-slate-600">—</span>;
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (tx.next_due_date === todayStr) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900/30 border border-amber-700 text-amber-400 whitespace-nowrap">
        Due today
      </span>
    );
  }
  const daysDiff = Math.round(
    (new Date(`${tx.next_due_date}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (daysDiff > 0 && daysDiff <= 3) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900/10 border border-amber-800/60 text-amber-300 whitespace-nowrap">
        Due in {daysDiff}d
      </span>
    );
  }
  return <span className="text-xs text-slate-500 whitespace-nowrap">Due {tx.next_due_date}</span>;
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Closed':
      return 'bg-green-900/30 border-green-700 text-green-400';
    case 'Contract Pending':
      return 'bg-yellow-900/30 border-yellow-700 text-yellow-400';
    case 'Under Contract':
      return 'bg-blue-900/30 border-blue-700 text-blue-400';
    default:
      return 'bg-slate-700/30 border-slate-600 text-slate-400';
  }
};

// Payment badge for a transaction's fee, whether or not it's been invoiced
// yet -- shared between the Active Transactions table and the Recently
// Closed snapshot.
const paymentBadgeClasses = (invoice: Invoice | undefined, isOverdue: boolean) => {
  if (!invoice) return 'bg-slate-700/40 border border-slate-600 text-slate-400';
  if (invoice.refunded) return 'bg-orange-900/30 border border-orange-700/50 text-orange-300';
  if (invoice.paid) return 'bg-green-900/30 border border-green-700/50 text-green-300';
  if (isOverdue) return 'bg-red-900/30 border border-red-700/50 text-red-300';
  return 'bg-amber-900/20 border border-amber-700/50 text-amber-300';
};

const paymentBadgeLabel = (invoice: Invoice | undefined, isOverdue: boolean) => {
  if (!invoice) return 'Not invoiced';
  if (invoice.refunded) return 'Refunded';
  if (invoice.paid) return 'Paid';
  if (isOverdue) return 'Overdue';
  return 'Unpaid';
};

export default function Dashboard() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [txRes, agentsRes, invoicesRes] = await Promise.all([
        authFetch('/api/transactions'),
        authFetch('/api/agents'),
        authFetch('/api/invoices'),
      ]);

      if (txRes.ok && agentsRes.ok && invoicesRes.ok) {
        const txData = await txRes.json();
        const agentsData = await agentsRes.json();
        const invoicesData = await invoicesRes.json();
        setTransactions(Array.isArray(txData) ? txData : []);
        setAgents(Array.isArray(agentsData) ? agentsData : []);
        setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    agents.forEach((a) => map.set(a.id, a));
    return map;
  }, [agents]);

  // Most recent invoice per transaction (a transaction should only ever
  // have one, but this stays correct even if that ever changes).
  const invoiceByTxId = useMemo(() => {
    const map = new Map<string, Invoice>();
    invoices.forEach((inv) => {
      const existing = map.get(inv.transaction_id);
      if (!existing || new Date(inv.invoice_date) >= new Date(existing.invoice_date)) {
        map.set(inv.transaction_id, inv);
      }
    });
    return map;
  }, [invoices]);

  const todayStr = new Date().toISOString().split('T')[0];

  const stats = useMemo(() => {
    const activeTransactions = transactions.filter((t) => t.status !== 'Closed');
    const closedTransactions = transactions.filter((t) => t.status === 'Closed');

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const isThisMonth = (dateStr: string | null | undefined) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= monthStart && d < nextMonthStart;
    };

    const closedThisMonth = closedTransactions.filter((t) => isThisMonth(t.closing_date || t.updated_at)).length;

    const unpaidInvoices = invoices.filter((inv) => !inv.paid && !inv.refunded);
    const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + (inv.amount_owed || 0), 0);
    const overdueUnpaidCount = unpaidInvoices.filter(
      (inv) => inv.due_date && inv.due_date < todayStr
    ).length;

    // Net of any refund -- a refunded payment isn't actually revenue
    // anymore, even though the invoice itself stays marked paid.
    const revenueThisMonth = invoices
      .filter((inv) => inv.paid && isThisMonth(inv.paid_at))
      .reduce((sum, inv) => sum + (inv.amount_owed || 0) - (inv.refunded_amount || 0), 0);

    // Average days from acceptance to closing, across every closed deal
    // that has both dates on file (all-time, not scoped to this month).
    const closedWithDates = closedTransactions.filter((t) => t.acceptance_date && t.closing_date);
    const avgDaysToClose =
      closedWithDates.length > 0
        ? Math.round(
            closedWithDates.reduce((sum, t) => {
              const days =
                (new Date(t.closing_date as string).getTime() - new Date(t.acceptance_date as string).getTime()) /
                (1000 * 60 * 60 * 24);
              return sum + days;
            }, 0) / closedWithDates.length
          )
        : null;

    return {
      activeCount: activeTransactions.length,
      closedThisMonth,
      unpaidCount: unpaidInvoices.length,
      unpaidAmount,
      overdueUnpaidCount,
      revenueThisMonth,
      avgDaysToClose,
      closedSampleSize: closedWithDates.length,
      totalAgents: agents.length,
    };
  }, [transactions, invoices, agents, todayStr]);

  const activeStatuses = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => {
      if (t.status !== 'Closed') set.add(t.status);
    });
    return Array.from(set).sort();
  }, [transactions]);

  const activeTransactionRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transactions
      .filter((t) => t.status !== 'Closed')
      .filter((t) => statusFilter === 'all' || t.status === statusFilter)
      .filter((t) => {
        if (!term) return true;
        const agentName = agentById.get(t.agent_id)?.name || '';
        return (
          t.property_address.toLowerCase().includes(term) ||
          t.file_number.toLowerCase().includes(term) ||
          agentName.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        if (!a.closing_date && !b.closing_date) return 0;
        if (!a.closing_date) return 1;
        if (!b.closing_date) return -1;
        return new Date(a.closing_date).getTime() - new Date(b.closing_date).getTime();
      });
  }, [transactions, statusFilter, search, agentById]);

  const activePreviewRows = activeTransactionRows.slice(0, 8);

  const recentlyClosedRows = useMemo(() => {
    return transactions
      .filter((t) => t.status === 'Closed')
      .sort((a, b) => {
        const aDate = a.closing_date || a.updated_at;
        const bDate = b.closing_date || b.updated_at;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      })
      .slice(0, 5);
  }, [transactions]);

  const feeForTransaction = (tx: Transaction, invoice: Invoice | undefined) => {
    if (invoice) return invoice.amount_owed;
    const agent = agentById.get(tx.agent_id);
    if (!agent) return null;
    return (agent.flat_fee || 0) + (tx.purchase_price * (agent.commission_percent || 0)) / 100;
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Dashboard</h1>
            <p className="text-slate-400">Welcome back to Relay TC</p>
          </div>
          <Link
            href="/dashboard/transactions/new"
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg hover:shadow-blue-500/50"
          >
            + New Deal
          </Link>
        </div>
        <div className="bg-slate-700/50 border border-dashed border-slate-600 rounded-lg p-16 text-center">
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No transactions yet</h3>
          <p className="text-slate-400 mb-6">Start by creating your first deal to get organized</p>
          <Link
            href="/dashboard/transactions/new"
            className="inline-block px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg transition hover:shadow-lg"
          >
            Create Your First Deal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Dashboard</h1>
          <p className="text-slate-400">Welcome back to Relay TC</p>
        </div>
        <Link
          href="/dashboard/transactions/new"
          className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg hover:shadow-blue-500/50 text-center"
        >
          + New Deal
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-400 mb-1">Active Deals</div>
          <div className="text-2xl font-bold text-blue-400">{stats.activeCount}</div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-400 mb-1">Unpaid Invoices</div>
          <div className={`text-2xl font-bold ${stats.overdueUnpaidCount > 0 ? 'text-red-400' : 'text-amber-400'}`}>
            {formatCurrency(stats.unpaidAmount)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {stats.unpaidCount} invoice{stats.unpaidCount !== 1 ? 's' : ''}
            {stats.overdueUnpaidCount > 0 && (
              <span className="text-red-400"> · {stats.overdueUnpaidCount} overdue</span>
            )}
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-400 mb-1">Revenue This Month</div>
          <div className="text-2xl font-bold text-green-400">{formatCurrency(stats.revenueThisMonth)}</div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-400 mb-1">Closed This Month</div>
          <div className="text-2xl font-bold text-green-400">{stats.closedThisMonth}</div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-400 mb-1">Avg. Days to Close</div>
          <div className="text-2xl font-bold text-blue-400">
            {stats.avgDaysToClose !== null ? stats.avgDaysToClose : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            all-time{stats.closedSampleSize > 0 ? ` · ${stats.closedSampleSize} deal${stats.closedSampleSize !== 1 ? 's' : ''}` : ''}
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-400 mb-1">Active Agents</div>
          <div className="text-2xl font-bold text-slate-200">{stats.totalAgents}</div>
        </div>
      </div>

      {/* Active Transactions */}
      <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Active Transactions</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search property, file #, or agent..."
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none w-full sm:w-64"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Stages</option>
              {activeStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {activeTransactionRows.length === 0 ? (
          <div className="bg-slate-800/40 border border-dashed border-slate-600 rounded-lg p-10 text-center text-slate-400">
            {transactions.some((t) => t.status !== 'Closed')
              ? 'No active transactions match your search.'
              : 'No active transactions right now.'}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-slate-800/40 border border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/60">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Closing</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Fee</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activePreviewRows.map((tx, index) => {
                    const invoice = invoiceByTxId.get(tx.id);
                    const isOverdue = !!invoice && !invoice.paid && !invoice.refunded && invoice.due_date < todayStr;
                    const fee = feeForTransaction(tx, invoice);
                    return (
                      <tr
                        key={tx.id}
                        className={`border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition ${
                          index % 2 === 0 ? 'bg-slate-800/20' : ''
                        }`}
                        onClick={() => router.push(`/dashboard/transactions/${tx.id}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="text-slate-100 font-medium truncate max-w-xs">{tx.property_address}</div>
                          <div className="text-xs text-slate-500 font-mono">{tx.file_number}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{agentById.get(tx.agent_id)?.name || 'Unknown'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(tx.status)}`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-300 text-sm">
                            {tx.closing_date ? new Date(`${tx.closing_date}T00:00:00`).toLocaleDateString() : '—'}
                          </div>
                          <div className="mt-0.5">{getDueBadge(tx)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-200 text-sm font-medium">{fee !== null ? formatCurrency(fee) : '—'}</div>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${paymentBadgeClasses(invoice, isOverdue)}`}>
                            {paymentBadgeLabel(invoice, isOverdue)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/dashboard/transactions/${tx.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {activePreviewRows.map((tx) => {
                const invoice = invoiceByTxId.get(tx.id);
                const isOverdue = !!invoice && !invoice.paid && !invoice.refunded && invoice.due_date < todayStr;
                const fee = feeForTransaction(tx, invoice);
                return (
                  <Link
                    key={tx.id}
                    href={`/dashboard/transactions/${tx.id}`}
                    className="block bg-slate-800/40 border border-slate-700 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="text-slate-100 font-medium truncate">{tx.property_address}</div>
                        <div className="text-xs text-slate-500 font-mono">{tx.file_number}</div>
                      </div>
                      <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(tx.status)}`}>
                        {tx.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
                      <span>{agentById.get(tx.agent_id)?.name || 'Unknown'}</span>
                      <span>{tx.closing_date ? new Date(`${tx.closing_date}T00:00:00`).toLocaleDateString() : 'No closing date'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-200 text-sm font-medium">{fee !== null ? formatCurrency(fee) : '—'}</span>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${paymentBadgeClasses(invoice, isOverdue)}`}>
                          {paymentBadgeLabel(invoice, isOverdue)}
                        </span>
                      </div>
                      {getDueBadge(tx)}
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {activeTransactionRows.length > activePreviewRows.length && (
          <div className="mt-3 text-right">
            <Link href="/dashboard/transactions" className="text-sm text-blue-400 hover:text-blue-300 font-medium">
              View all {activeTransactionRows.length} active transactions →
            </Link>
          </div>
        )}
        {activeTransactionRows.length > 0 && activeTransactionRows.length <= activePreviewRows.length && (
          <div className="mt-3 text-right">
            <Link href="/dashboard/transactions" className="text-sm text-blue-400 hover:text-blue-300 font-medium">
              View all transactions →
            </Link>
          </div>
        )}
      </div>

      {/* Recently Closed snapshot */}
      {recentlyClosedRows.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Recently Closed</h2>
          <div className="bg-slate-800/40 border border-slate-700 rounded-lg divide-y divide-slate-700/60">
            {recentlyClosedRows.map((tx) => {
              const invoice = invoiceByTxId.get(tx.id);
              const isOverdue = !!invoice && !invoice.paid && !invoice.refunded && invoice.due_date < todayStr;
              const fee = feeForTransaction(tx, invoice);
              return (
                <Link
                  key={tx.id}
                  href={`/dashboard/transactions/${tx.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-700/30 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-100 font-medium truncate">{tx.property_address}</div>
                    <div className="text-xs text-slate-500">
                      {agentById.get(tx.agent_id)?.name || 'Unknown'} · Closed{' '}
                      {tx.closing_date ? new Date(`${tx.closing_date}T00:00:00`).toLocaleDateString() : new Date(tx.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-slate-200 text-sm font-medium">{fee !== null ? formatCurrency(fee) : '—'}</span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${paymentBadgeClasses(invoice, isOverdue)}`}>
                      {paymentBadgeLabel(invoice, isOverdue)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
