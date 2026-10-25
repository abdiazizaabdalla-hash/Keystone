'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import AgentTransactionList, { type AgentTransaction } from '@/components/AgentTransactionList';

// Every deal this agent has been added to, across every coordinator.
export default function AgentTransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<AgentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open');

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/agent/transactions');
        if (!res.ok) throw new Error('Failed to load your transactions');
        const data = await res.json();
        setTransactions(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        setError('Could not load your transactions. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const multiTc = useMemo(() => new Set(transactions.map((t) => t.tcLabel).filter(Boolean)).size > 1, [transactions]);
  const openCount = transactions.filter((t) => t.status !== 'Closed').length;
  const closedCount = transactions.length - openCount;
  // Nothing open? Show everything instead of an empty "Open" view.
  const view = filter === 'open' && openCount === 0 ? 'all' : filter;
  const shown = transactions.filter((t) => (view === 'all' ? true : view === 'closed' ? t.status === 'Closed' : t.status !== 'Closed'));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 md:mb-8">
          <h1 className="text-xl md:text-2xl font-display font-semibold text-slate-100">Transactions</h1>
          <p className="text-slate-400 text-sm mt-0.5">Every deal you have been added to.</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {([
            ['open', `Open (${openCount})`],
            ['closed', `Closed (${closedCount})`],
            ['all', `All (${transactions.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
                view === key ? 'bg-blue-500 text-white' : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : shown.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
            <p className="text-slate-400 text-sm">{transactions.length === 0 ? "You aren't on any transactions yet." : 'Nothing in this view.'}</p>
            {transactions.length === 0 && <p className="text-slate-500 text-xs mt-1">Once a transaction coordinator adds you to one, it will show up here.</p>}
          </div>
        ) : (
          <AgentTransactionList transactions={shown} multiTc={multiTc} />
        )}
      </div>
    </div>
  );
}
