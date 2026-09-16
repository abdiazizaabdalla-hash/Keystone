'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DashboardStats {
  totalTransactions: number;
  activeTransactions: number;
  completedTransactions: number;
  agentsCount: number;
}

export default function Home() {
  const [stats, setStats] = useState<DashboardStats>({
    totalTransactions: 0,
    activeTransactions: 0,
    completedTransactions: 0,
    agentsCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [txRes, agentsRes] = await Promise.all([
        fetch('/api/transactions'),
        fetch('/api/agents'),
      ]);

      if (!txRes.ok || !agentsRes.ok) throw new Error('Failed to fetch');

      const transactions = await txRes.json();
      const agents = await agentsRes.json();

      const active = Array.isArray(transactions)
        ? transactions.filter((t: any) => t.status !== 'Closed').length
        : 0;
      const completed = Array.isArray(transactions)
        ? transactions.filter((t: any) => t.status === 'Closed').length
        : 0;

      setStats({
        totalTransactions: Array.isArray(transactions) ? transactions.length : 0,
        activeTransactions: active,
        completedTransactions: completed,
        agentsCount: Array.isArray(agents) ? agents.length : 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 py-24">
        <div className="max-w-7xl mx-auto">
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-400 bg-clip-text text-transparent">
                  Transaction Intelligence
                </span>
                <br />
                <span className="text-slate-100">for Coordinators</span>
              </h1>
              <p className="text-xl text-slate-400 max-w-2xl">
                Manage your entire transaction workflow in one place. Streamline operations, reduce paperwork, and focus on what matters.
              </p>
            </div>

            <div className="flex gap-4 pt-4">
              <Link
                href="/transactions"
                className="px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-lg transition shadow-lg hover:shadow-amber-500/50"
              >
                View Transactions
              </Link>
              <Link
                href="/transactions/new"
                className="px-8 py-3 border border-slate-700 hover:border-amber-400 text-slate-100 font-semibold rounded-lg transition hover:bg-slate-800/50"
              >
                Create New Deal
              </Link>
            </div>
          </div>
        </div>

        {/* Gradient orbs */}
        <div className="absolute top-20 right-0 w-96 h-96 bg-amber-600/20 rounded-full blur-3xl -z-10" />
        <div className="absolute -bottom-20 left-0 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl -z-10" />
      </section>

      {/* Stats Section */}
      {!loading && (
        <section className="px-6 py-16 border-t border-slate-800">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {/* Total Transactions */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition">
                <div className="text-sm text-slate-400 mb-2">Total Deals</div>
                <div className="text-3xl font-bold text-amber-400">{stats.totalTransactions}</div>
                <div className="text-xs text-slate-500 mt-2">all time</div>
              </div>

              {/* Active Transactions */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition">
                <div className="text-sm text-slate-400 mb-2">Active Deals</div>
                <div className="text-3xl font-bold text-blue-400">{stats.activeTransactions}</div>
                <div className="text-xs text-slate-500 mt-2">in progress</div>
              </div>

              {/* Completed Transactions */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition">
                <div className="text-sm text-slate-400 mb-2">Completed</div>
                <div className="text-3xl font-bold text-green-400">{stats.completedTransactions}</div>
                <div className="text-xs text-slate-500 mt-2">closed</div>
              </div>

              {/* Agents */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition">
                <div className="text-sm text-slate-400 mb-2">Active Agents</div>
                <div className="text-3xl font-bold text-purple-400">{stats.agentsCount}</div>
                <div className="text-xs text-slate-500 mt-2">in network</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="px-6 py-16">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold mb-8 text-slate-100">Quick Actions</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Create Transaction */}
            <Link
              href="/transactions/new"
              className="group bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 hover:border-amber-500 rounded-lg p-8 transition hover:bg-slate-800/50"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center mb-4 group-hover:shadow-lg group-hover:shadow-amber-500/50 transition">
                <svg className="w-6 h-6 text-slate-950" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-100 mb-2">Create New Deal</h3>
              <p className="text-slate-400 text-sm">Start a new transaction and auto-generate your checklist</p>
            </Link>

            {/* View Transactions */}
            <Link
              href="/transactions"
              className="group bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 hover:border-blue-500 rounded-lg p-8 transition hover:bg-slate-800/50"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center mb-4 group-hover:shadow-lg group-hover:shadow-blue-500/50 transition">
                <svg className="w-6 h-6 text-slate-950" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
                  <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm5 4a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-100 mb-2">View All Transactions</h3>
              <p className="text-slate-400 text-sm">Manage and track all your active and completed deals</p>
            </Link>

            {/* Coming Soon: Invoicing */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-8 opacity-60 cursor-not-allowed">
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-slate-950" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-100 mb-2">Invoicing</h3>
              <p className="text-slate-400 text-sm">Auto-generate invoices and track payments (Coming Soon)</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Preview */}
      <section className="px-6 py-16 border-t border-slate-800">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold mb-12 text-slate-100">Built for Transaction Coordinators</h2>
          <div className="grid md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-amber-400">✓</span>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">Smart Checklists</h3>
                  <p className="text-slate-400 text-sm mt-1">Auto-generated task templates for every deal stage</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-blue-400">✓</span>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">Multi-Agent Support</h3>
                  <p className="text-slate-400 text-sm mt-1">Manage unlimited agents and their transactions</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-green-400">✓</span>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">Real-time Updates</h3>
                  <p className="text-slate-400 text-sm mt-1">Instant sync across all your devices</p>
                </div>
              </div>
            </div>
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-purple-400">✓</span>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">Progress Tracking</h3>
                  <p className="text-slate-400 text-sm mt-1">Visual indicators for deal completion status</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-pink-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-pink-400">✓</span>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">Organized & Secure</h3>
                  <p className="text-slate-400 text-sm mt-1">Enterprise-grade data protection with role-based access</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                  <span className="text-yellow-400">✓</span>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">Coming Soon: Invoicing</h3>
                  <p className="text-slate-400 text-sm mt-1">Auto-generate invoices directly from closed deals</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
