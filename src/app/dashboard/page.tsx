'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface TransactionSummary {
  status: string;
  closing_date: string | null;
  acceptance_date: string | null;
  updated_at: string;
}

interface InvoiceSummary {
  paid: boolean;
  paid_at: string | null;
  amount_owed: number;
  refunded_amount: number | null;
}

interface DashboardStats {
  activeTransactions: number;
  completedTransactions: number;
  totalAgents: number;
  outstandingInvoices: number;
  outstandingAmount: number;
  closedThisMonth: number;
  revenueThisMonth: number;
  avgDaysToClose: number | null;
}

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    activeTransactions: 0,
    completedTransactions: 0,
    totalAgents: 0,
    outstandingInvoices: 0,
    outstandingAmount: 0,
    closedThisMonth: 0,
    revenueThisMonth: 0,
    avgDaysToClose: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [txRes, agentsRes, invoicesRes] = await Promise.all([
        authFetch('/api/transactions'),
        authFetch('/api/agents'),
        authFetch('/api/invoices'),
      ]);

      if (txRes.ok && agentsRes.ok && invoicesRes.ok) {
        const transactions: TransactionSummary[] = await txRes.json();
        const agents = await agentsRes.json();
        const invoices: InvoiceSummary[] = await invoicesRes.json();

        const active = Array.isArray(transactions)
          ? transactions.filter((t) => t.status !== 'Closed').length
          : 0;
        const completed = Array.isArray(transactions)
          ? transactions.filter((t) => t.status === 'Closed').length
          : 0;
        const outstanding = Array.isArray(invoices)
          ? invoices.filter((inv) => !inv.paid)
          : [];
        const outstandingAmount = outstanding.reduce(
          (sum: number, inv) => sum + (inv.amount_owed || 0),
          0
        );

        // "This month" is the current calendar month in the browser's own
        // timezone -- good enough for a summary tile, not meant to be an
        // exact accounting cutoff.
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const isThisMonth = (dateStr: string | null | undefined) => {
          if (!dateStr) return false;
          const d = new Date(dateStr);
          return d >= monthStart && d < nextMonthStart;
        };

        const closedThisMonth = Array.isArray(transactions)
          ? transactions.filter(
              (t) => t.status === 'Closed' && isThisMonth(t.closing_date || t.updated_at)
            ).length
          : 0;

        // Net of any refund -- a refunded payment isn't actually revenue
        // anymore, even though the invoice itself stays marked paid.
        const revenueThisMonth = Array.isArray(invoices)
          ? invoices
              .filter((inv) => inv.paid && isThisMonth(inv.paid_at))
              .reduce((sum, inv) => sum + (inv.amount_owed || 0) - (inv.refunded_amount || 0), 0)
          : 0;

        // Average days from acceptance to closing, across every closed deal
        // that has both dates on file -- deals missing either date (common
        // for transactions created before that field existed) are left out
        // rather than skewing the average with a guess.
        const closedWithDates = Array.isArray(transactions)
          ? transactions.filter((t) => t.status === 'Closed' && t.acceptance_date && t.closing_date)
          : [];
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

        setStats({
          activeTransactions: active,
          completedTransactions: completed,
          totalAgents: Array.isArray(agents) ? agents.length : 0,
          outstandingInvoices: outstanding.length,
          outstandingAmount,
          closedThisMonth,
          revenueThisMonth,
          avgDaysToClose,
        });
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-display font-semibold text-slate-100 mb-2">Dashboard</h1>
        <p className="text-slate-400">Welcome back to Relay TC</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Active Deals</div>
          <div className="text-3xl font-bold text-blue-400">
            {stats.activeTransactions}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Completed</div>
          <div className="text-3xl font-bold text-green-400">
            {stats.completedTransactions}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Active Agents</div>
          <div className="text-3xl font-bold text-purple-400">
            {stats.totalAgents}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Outstanding</div>
          <div className="text-3xl font-bold text-red-400">
            {stats.outstandingInvoices}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Amount Due</div>
          <div className="text-3xl font-bold text-blue-400">
            ${(stats.outstandingAmount / 1000).toFixed(1)}k
          </div>
        </div>
      </div>

      {/* Performance -- this calendar month, plus an all-time average */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">This Month</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Closed This Month</div>
            <div className="text-3xl font-bold text-green-400">{stats.closedThisMonth}</div>
          </div>

          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Revenue Collected</div>
            <div className="text-3xl font-bold text-green-400">
              ${stats.revenueThisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Avg. Days to Close</div>
            <div className="text-3xl font-bold text-blue-400">
              {stats.avgDaysToClose !== null ? stats.avgDaysToClose : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          href="/dashboard/transactions/new"
          className="group bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 hover:border-blue-500 rounded-lg p-6 transition"
        >
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center mb-4 group-hover:shadow-lg group-hover:shadow-blue-500/50 transition">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-100 mb-1">New Deal</h3>
          <p className="text-slate-400 text-sm">Start a new transaction</p>
        </Link>

        <Link
          href="/dashboard/agents"
          className="group bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 hover:border-purple-500 rounded-lg p-6 transition"
        >
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center mb-4 group-hover:shadow-lg group-hover:shadow-purple-500/50 transition">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-100 mb-1">Agents</h3>
          <p className="text-slate-400 text-sm">Manage agent profiles & fees</p>
        </Link>

        <Link
          href="/dashboard/invoices"
          className="group bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 hover:border-green-500 rounded-lg p-6 transition"
        >
          <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center mb-4 group-hover:shadow-lg group-hover:shadow-green-500/50 transition">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-100 mb-1">Invoices</h3>
          <p className="text-slate-400 text-sm">Track payments & fees</p>
        </Link>
      </div>
    </div>
  );
}
