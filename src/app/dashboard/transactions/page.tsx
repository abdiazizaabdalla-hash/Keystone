'use client';

import { useEffect, useState } from 'react';
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
  created_at: string;
  /** Earliest incomplete task's due_date across this deal's checklist, or null. */
  next_due_date?: string | null;
  /** How many incomplete tasks on this deal are already past their due_date. */
  overdue_count?: number;
}

interface Agent {
  id: string;
  name: string;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agents, setAgents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [txRes, agentsRes] = await Promise.all([
        authFetch('/api/transactions'),
        authFetch('/api/agents'),
      ]);

      const txData = await txRes.json();
      const agentsData = await agentsRes.json();

      if (!Array.isArray(txData)) {
        throw new Error(`Transactions API error: ${JSON.stringify(txData)}`);
      }
      if (!Array.isArray(agentsData)) {
        throw new Error(`Agents API error: ${JSON.stringify(agentsData)}`);
      }

      setTransactions(txData);

      const agentMap = new Map<string, string>();
      agentsData.forEach((agent: Agent) => {
        agentMap.set(agent.id, agent.name);
      });
      setAgents(agentMap);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error fetching data:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Color-coded due-date flag for the list -- overdue wins over
  // due-soon, and a Closed deal never shows one (nothing left to chase).
  const getDueBadge = (tx: Transaction) => {
    if (tx.status === 'Closed') {
      return <span className="text-xs text-slate-600">—</span>;
    }
    if (tx.overdue_count && tx.overdue_count > 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-900/30 border border-red-700 text-red-400 whitespace-nowrap">
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
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/30 border border-amber-700 text-amber-400 whitespace-nowrap">
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
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/10 border border-amber-800/60 text-amber-300 whitespace-nowrap">
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

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this transaction? This also removes its checklist, uploaded documents, and any invoice generated from it. This cannot be undone.')) {
      return;
    }

    try {
      setDeletingId(id);
      const response = await authFetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete transaction');
      }
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      alert(error instanceof Error ? error.message : 'Failed to delete transaction');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading transactions...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Transactions</h2>
            <p className="text-red-200 mb-4">{error}</p>
            <p className="text-red-300 text-sm">
              💡 If you see "permission denied", run the Supabase SQL grant statements in your Supabase dashboard.
            </p>
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
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-display font-semibold text-slate-100 mb-2">Transactions</h1>
              <p className="text-slate-400">Manage and track all your active and closed deals</p>
            </div>
            <Link
              href="/dashboard/transactions/new"
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg hover:shadow-blue-500/50"
            >
              + New Deal
            </Link>
          </div>
        </div>

        {/* Empty State */}
        {transactions.length === 0 ? (
          <div className="bg-slate-700/50 border border-dashed border-slate-600 rounded-lg p-16 text-center">
            <div className="w-16 h-16 bg-slate-600/50 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No transactions yet</h3>
            <p className="text-slate-400 mb-6">Start by creating your first deal to get organized</p>
            <Link
              href="/dashboard/transactions/new"
              className="inline-block px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg transition hover:shadow-lg"
            >
              Create Your First Deal
            </Link>
          </div>
        ) : (
          /* Transactions Table */
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-600 bg-slate-800/50">
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">File #</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Price</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Next Due</span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, index) => (
                    <tr
                      key={tx.id}
                      className={`border-b border-slate-600/50 hover:bg-slate-600/30 cursor-pointer transition ${
                        index % 2 === 0 ? 'bg-slate-700/20' : ''
                      }`}
                      onClick={() => (window.location.href = `/dashboard/transactions/${tx.id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">
                            {(agents.get(tx.agent_id) || 'A')[0]}
                          </div>
                          <span className="font-medium text-slate-100">{agents.get(tx.agent_id) || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm text-slate-300">{tx.file_number}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-300 max-w-xs truncate block">{tx.property_address}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-blue-400">${tx.purchase_price.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(tx.status)}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {getDueBadge(tx)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(e) => handleDelete(e, tx.id)}
                          disabled={deletingId === tx.id}
                          className="text-slate-500 hover:text-red-400 text-sm font-medium transition disabled:opacity-50"
                          title="Delete transaction"
                        >
                          {deletingId === tx.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="border-t border-slate-600 bg-slate-800/30 px-6 py-3">
              <p className="text-sm text-slate-400">
                Showing <span className="font-semibold text-slate-300">{transactions.length}</span> transaction{transactions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
