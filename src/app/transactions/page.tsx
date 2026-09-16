'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Transaction {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agents, setAgents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [txRes, agentsRes] = await Promise.all([
        fetch('/api/transactions'),
        fetch('/api/agents'),
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error fetching data:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
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
        return 'bg-slate-800/30 border-slate-700 text-slate-400';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-amber-400 animate-spin mx-auto mb-4" />
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
              <h1 className="text-4xl font-bold text-slate-100 mb-2">Transactions</h1>
              <p className="text-slate-400">Manage and track all your active and closed deals</p>
            </div>
            <Link
              href="/transactions/new"
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-lg transition shadow-lg hover:shadow-amber-500/50"
            >
              + New Deal
            </Link>
          </div>
        </div>

        {/* Empty State */}
        {transactions.length === 0 ? (
          <div className="bg-slate-800/50 border border-dashed border-slate-700 rounded-lg p-16 text-center">
            <div className="w-16 h-16 bg-slate-700/50 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No transactions yet</h3>
            <p className="text-slate-400 mb-6">Start by creating your first deal to get organized</p>
            <Link
              href="/transactions/new"
              className="inline-block px-6 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-semibold rounded-lg transition hover:shadow-lg"
            >
              Create Your First Deal
            </Link>
          </div>
        ) : (
          /* Transactions Table */
          <div className="bg-slate-800/30 border border-slate-700 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/50">
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
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, index) => (
                    <tr
                      key={tx.id}
                      className={`border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition ${
                        index % 2 === 0 ? 'bg-slate-800/20' : ''
                      }`}
                      onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center text-xs font-bold text-slate-950">
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
                        <span className="font-semibold text-amber-400">${tx.purchase_price.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(tx.status)}`}>
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="border-t border-slate-700 bg-slate-900/30 px-6 py-3">
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
