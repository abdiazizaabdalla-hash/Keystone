'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';

interface Transaction {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
}

interface Task {
  id: string;
  transaction_id: string;
  name: string;
  completed: boolean;
}

interface Agent {
  id: string;
  name: string;
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agentName, setAgentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [resolvedParams.id]);

  const fetchData = async () => {
    try {
      const [txRes, tasksRes, agentsRes] = await Promise.all([
        fetch('/api/transactions'),
        fetch(`/api/tasks?transactionId=${resolvedParams.id}`),
        fetch('/api/agents'),
      ]);

      const txData = await txRes.json();
      const tasksData = await tasksRes.json();
      const agentsData = await agentsRes.json();

      if (!Array.isArray(txData)) {
        throw new Error(`Transactions API error: ${JSON.stringify(txData)}`);
      }
      if (!Array.isArray(tasksData)) {
        throw new Error(`Tasks API error: ${JSON.stringify(tasksData)}`);
      }
      if (!Array.isArray(agentsData)) {
        throw new Error(`Agents API error: ${JSON.stringify(agentsData)}`);
      }

      const tx = txData.find((t: Transaction) => t.id === resolvedParams.id);
      setTransaction(tx || null);
      setTasks(tasksData);

      if (tx) {
        const agent = agentsData.find((a: Agent) => a.id === tx.agent_id);
        setAgentName(agent?.name || 'Unknown');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error fetching data:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(`Failed to toggle task: ${JSON.stringify(result)}`);
      }

      fetchData();
    } catch (error) {
      console.error('Error toggling task:', error);
      alert('Failed to toggle task. Check console for details.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/transactions" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-amber-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading transaction...</p>
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
          <Link href="/transactions" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Transaction</h2>
            <p className="text-red-200 mb-4">{error}</p>
            <p className="text-red-300 text-sm">
              💡 If you see "permission denied", run the Supabase SQL grant statements in your Supabase dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/transactions" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="text-center py-24">
            <h2 className="text-xl font-semibold text-slate-300 mb-2">Transaction not found</h2>
            <p className="text-slate-400">The transaction you're looking for doesn't exist.</p>
          </div>
        </div>
      </div>
    );
  }

  const completedCount = tasks.filter((t) => t.completed).length;
  const completionPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <Link href="/transactions" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Transactions
        </Link>

        {/* Main Card */}
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8 mb-8">
          <div className="mb-8">
            <span className="inline-block px-3 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-300 text-sm font-semibold rounded-full mb-4">
              {transaction.status}
            </span>
            <h1 className="text-4xl font-bold text-slate-100 mb-2">{transaction.file_number}</h1>
            <p className="text-slate-400">{transaction.property_address}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-6 border-t border-slate-700">
            {/* Agent */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center text-sm font-bold text-slate-950">
                  {agentName[0]}
                </div>
                <p className="text-lg font-semibold text-slate-100">{agentName}</p>
              </div>
            </div>

            {/* Purchase Price */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Purchase Price</p>
              <p className="text-2xl font-bold text-amber-400">${transaction.purchase_price.toLocaleString()}</p>
            </div>

            {/* Status */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</p>
              <p className="text-lg font-semibold text-slate-100">{transaction.status}</p>
            </div>
          </div>
        </div>

        {/* Tasks Section */}
        <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-100 mb-4">Transaction Checklist</h2>

            {/* Progress Bar */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-slate-400">Progress</span>
                  <span className="text-sm font-semibold text-amber-400">{completionPercent}%</span>
                </div>
                <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-300"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-400 mt-3">
              <span className="font-semibold text-slate-300">{completedCount}</span> of <span className="font-semibold text-slate-300">{tasks.length}</span> completed
            </p>
          </div>

          {/* Tasks List */}
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-4 p-4 bg-slate-800/30 border border-slate-700 rounded-lg hover:border-slate-600 transition group cursor-pointer"
                onClick={() => handleToggleTask(task.id)}
              >
                <div className="flex-shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => handleToggleTask(task.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-5 h-5 rounded border-2 border-slate-600 accent-amber-500 cursor-pointer"
                  />
                </div>
                <div className="flex-1">
                  <span
                    className={`block font-medium ${
                      task.completed
                        ? 'line-through text-slate-500'
                        : 'text-slate-200 group-hover:text-slate-100'
                    }`}
                  >
                    {task.name}
                  </span>
                </div>
                {task.completed && (
                  <div className="flex-shrink-0 text-green-400">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
