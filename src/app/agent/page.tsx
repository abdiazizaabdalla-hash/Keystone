'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface AgentTransaction {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  status: string;
  tcUserId: string;
  tcLabel: string;
  nextDueDate: string | null;
  overdueCount: number;
}

interface TcGroup {
  tcUserId: string;
  tcLabel: string;
  transactions: AgentTransaction[];
}

// Same status colors as src/app/dashboard/transactions/page.tsx, so a
// deal reads the same way here as it does on the TC's own list.
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

// Same due-date flag logic as the TC list -- overdue wins, Closed shows
// nothing, otherwise "Due today" / "Due in Nd" / a plain date.
const getDueBadge = (tx: AgentTransaction) => {
  if (tx.status === 'Closed') {
    return <span className="text-xs text-slate-600">—</span>;
  }
  if (tx.overdueCount > 0) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-900/30 border border-red-700 text-red-400 whitespace-nowrap">
        {tx.overdueCount} overdue
      </span>
    );
  }
  if (!tx.nextDueDate) {
    return <span className="text-xs text-slate-600">—</span>;
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (tx.nextDueDate === todayStr) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/30 border border-amber-700 text-amber-400 whitespace-nowrap">
        Due today
      </span>
    );
  }
  const daysDiff = Math.round(
    (new Date(`${tx.nextDueDate}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (daysDiff > 0 && daysDiff <= 3) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/10 border border-amber-800/60 text-amber-300 whitespace-nowrap">
        Due in {daysDiff}d
      </span>
    );
  }
  return <span className="text-xs text-slate-500 whitespace-nowrap">Due {tx.nextDueDate}</span>;
};

// The whole point of one login across every TC that's added this agent:
// this list is the union of every transaction_agents row for them,
// regardless of which TC/brokerage it came from (see
// GET /api/agent/transactions). Grouped by TC below since most agents
// only ever work with one, but some work several deals across a few.
export default function AgentHubPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<AgentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
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
        console.error('Error loading agent transactions:', err);
        setError('Could not load your transactions. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router]);

  const tcGroups = useMemo<TcGroup[]>(() => {
    const byTc = new Map<string, TcGroup>();
    for (const tx of transactions) {
      const key = tx.tcUserId || tx.tcLabel;
      const existing = byTc.get(key);
      if (existing) {
        existing.transactions.push(tx);
      } else {
        byTc.set(key, { tcUserId: tx.tcUserId, tcLabel: tx.tcLabel, transactions: [tx] });
      }
    }
    return Array.from(byTc.values()).sort((a, b) => a.tcLabel.localeCompare(b.tcLabel));
  }, [transactions]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <img src="/relay-icon.png" alt="Relay TC" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="text-2xl font-display font-semibold text-slate-100">Your deals</h1>
            <p className="text-slate-400 text-sm mt-0.5">Every transaction you&apos;ve been added to, across every TC.</p>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : transactions.length === 0 ? (
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center">
            <p className="text-slate-300">You don&apos;t have access to any deals yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              Once a transaction coordinator adds you to one, it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <>
            {/* Your TCs -- most agents only ever see one card here. */}
            <div className="mb-8">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Your TCs</p>
              <div className="flex flex-wrap gap-3">
                {tcGroups.map((g) => (
                  <div
                    key={g.tcUserId || g.tcLabel}
                    className="flex items-center gap-3 bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg px-4 py-3"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {g.tcLabel[0]?.toUpperCase() || 'T'}
                    </div>
                    <div>
                      <p className="text-slate-100 text-sm font-semibold leading-tight">{g.tcLabel}</p>
                      <p className="text-slate-500 text-xs leading-tight">
                        {g.transactions.length} transaction{g.transactions.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* One table per TC, same column layout as the TC's own
                transactions list (minus price/agent/delete, which are
                TC-only). */}
            <div className="space-y-8">
              {tcGroups.map((g) => (
                <div key={g.tcUserId || g.tcLabel}>
                  <p className="text-sm font-semibold text-slate-300 mb-2">{g.tcLabel}</p>
                  <div className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-600 bg-slate-800/50">
                            <th className="px-6 py-4 text-left">
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">File #</span>
                            </th>
                            <th className="px-6 py-4 text-left">
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</span>
                            </th>
                            <th className="px-6 py-4 text-left">
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</span>
                            </th>
                            <th className="px-6 py-4 text-left">
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Next Due</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.transactions.map((tx, index) => (
                            <tr
                              key={tx.id}
                              className={`border-b border-slate-600/50 hover:bg-slate-600/30 cursor-pointer transition ${
                                index % 2 === 0 ? 'bg-slate-700/20' : ''
                              }`}
                              onClick={() => router.push(`/agent/transactions/${tx.id}`)}
                            >
                              <td className="px-6 py-4">
                                <span className="font-mono text-sm text-slate-300">{tx.fileNumber}</span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-slate-300 max-w-xs truncate block">
                                  {tx.propertyAddress || tx.fileNumber}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(tx.status)}`}
                                >
                                  {tx.status}
                                </span>
                              </td>
                              <td className="px-6 py-4">{getDueBadge(tx)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
