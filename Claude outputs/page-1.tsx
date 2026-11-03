'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
  email: string;
  phone: string;
  flat_fee: number;
  commission_percent: number;
}

interface Transaction {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  created_at: string;
}

interface AgentWithTransactions extends Agent {
  active_transactions: Transaction[];
  transaction_count: number;
}

export default function AgentsDashboard() {
  const [agents, setAgents] = useState<AgentWithTransactions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [agentsRes, txRes] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/transactions'),
      ]);

      if (!agentsRes.ok || !txRes.ok) throw new Error('Failed to fetch data');

      const agentsData: Agent[] = await agentsRes.json();
      const txData: Transaction[] = await txRes.json();

      setTransactions(txData);

      // Enrich agents with their active transactions
      const agentsWithTx = agentsData.map((agent) => ({
        ...agent,
        active_transactions: txData.filter(
          (tx) => tx.agent_id === agent.id && tx.status !== 'Closed'
        ),
        transaction_count: txData.filter((tx) => tx.agent_id === agent.id).length,
      }));

      setAgents(agentsWithTx);
      setError(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Contract Pending':
        return 'bg-yellow-500/20 text-yellow-300';
      case 'Pre-Approval':
        return 'bg-blue-500/20 text-blue-300';
      case 'In Progress':
        return 'bg-purple-500/20 text-purple-300';
      case 'Final Review':
        return 'bg-pink-500/20 text-pink-300';
      default:
        return 'bg-slate-500/20 text-slate-300';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-amber-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading agents dashboard...</p>
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
        <div className="mb-12 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-100 mb-2">Agents Dashboard</h1>
            <p className="text-slate-400">Overview of all agents and their active transactions</p>
          </div>
          <Link
            href="/agents"
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold rounded-lg transition"
          >
            Manage Agents
          </Link>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error</h2>
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Total Agents</div>
            <div className="text-3xl font-bold text-amber-400">{agents.length}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Total Deals</div>
            <div className="text-3xl font-bold text-blue-400">
              {transactions.length}
            </div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
            <div className="text-sm text-slate-400 mb-2">Active Deals</div>
            <div className="text-3xl font-bold text-purple-400">
              {transactions.filter((t) => t.status !== 'Closed').length}
            </div>
          </div>
        </div>

        {/* Agents Grid */}
        {agents.length === 0 ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.856-1.487M15 10a3 3 0 11-6 0 3 3 0 016 0zM6 20a3 3 0 003-3v-2a3 3 0 00-3-3H3a3 3 0 00-3 3v2a3 3 0 003 3h3z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No agents yet</h3>
            <p className="text-slate-400 mb-6">Add your first agent to get started</p>
            <Link
              href="/agents"
              className="inline-block px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-lg transition"
            >
              Add Agent
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg overflow-hidden"
              >
                {/* Agent Header */}
                <div className="p-6 border-b border-slate-700">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center text-sm font-bold text-slate-950">
                        {agent.name[0]}
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-slate-100">{agent.name}</h3>
                        <p className="text-sm text-slate-400">{agent.brokerage || 'No brokerage'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-400 mb-1">Fee Structure</div>
                      <div className="text-lg font-semibold text-amber-400">
                        ${agent.flat_fee.toLocaleString()} + {agent.commission_percent}%
                      </div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="grid md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700">
                    {agent.email && (
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Email</p>
                        <p className="text-slate-300">{agent.email}</p>
                      </div>
                    )}
                    {agent.phone && (
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Phone</p>
                        <p className="text-slate-300">{agent.phone}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Transactions */}
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <h4 className="text-lg font-semibold text-slate-100">
                      Active Transactions
                    </h4>
                    <span className="px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-sm font-medium">
                      {agent.active_transactions.length}
                    </span>
                  </div>

                  {agent.active_transactions.length === 0 ? (
                    <p className="text-slate-400 text-sm">No active transactions</p>
                  ) : (
                    <div className="space-y-3">
                      {agent.active_transactions.map((tx) => (
                        <div
                          key={tx.id}
                          className="bg-slate-700/30 border border-slate-600 rounded-lg p-4 hover:border-slate-500 transition"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="font-semibold text-slate-100">{tx.property_address}</p>
                              <p className="text-sm text-slate-400 mt-1">
                                File: {tx.file_number} • Price: ${tx.purchase_price.toLocaleString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(tx.status)}`}>
                                {tx.status}
                              </span>
                              <Link
                                href={`/transactions/${tx.id}`}
                                className="px-3 py-1 text-sm bg-slate-600 hover:bg-slate-500 text-slate-100 rounded transition"
                              >
                                View
                              </Link>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* All Transactions Count */}
                  {agent.transaction_count > agent.active_transactions.length && (
                    <div className="mt-4 pt-4 border-t border-slate-700">
                      <p className="text-sm text-slate-400">
                        {agent.transaction_count - agent.active_transactions.length} closed deals
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
