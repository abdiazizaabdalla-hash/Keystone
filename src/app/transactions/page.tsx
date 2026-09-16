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

      // Check if API returned error
      if (!Array.isArray(txData)) {
        throw new Error(`Transactions API error: ${JSON.stringify(txData)}`);
      }
      if (!Array.isArray(agentsData)) {
        throw new Error(`Agents API error: ${JSON.stringify(agentsData)}`);
      }

      setTransactions(txData);

      // Create agent name map
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

  if (loading) return <div className="p-8">Loading...</div>;

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6">
            <h2 className="text-xl font-bold text-red-200 mb-2">Error Loading Transactions</h2>
            <p className="text-red-100 mb-4">{error}</p>
            <p className="text-red-200 text-sm">
              💡 If you see "permission denied", run the Supabase SQL grant statements first.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">Transactions</h1>
          <Link
            href="/transactions/new"
            className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-semibold"
          >
            + Create Transaction
          </Link>
        </div>

        {transactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-4">No transactions yet</p>
            <Link
              href="/transactions/new"
              className="text-blue-400 hover:underline"
            >
              Create your first transaction
            </Link>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-700">
                  <th className="px-6 py-3 text-left">Agent</th>
                  <th className="px-6 py-3 text-left">File #</th>
                  <th className="px-6 py-3 text-left">Property</th>
                  <th className="px-6 py-3 text-left">Price</th>
                  <th className="px-6 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-t border-gray-700 hover:bg-gray-700 cursor-pointer"
                    onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                  >
                    <td className="px-6 py-3">{agents.get(tx.agent_id) || 'Unknown'}</td>
                    <td className="px-6 py-3">{tx.file_number}</td>
                    <td className="px-6 py-3">{tx.property_address}</td>
                    <td className="px-6 py-3">${tx.purchase_price.toLocaleString()}</td>
                    <td className="px-6 py-3">
                      <span className="bg-green-900 text-green-200 px-3 py-1 rounded-full text-sm">
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
