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
      const tx = txData.find((t: Transaction) => t.id === resolvedParams.id);
      setTransaction(tx || null);

      const tasksData = await tasksRes.json();
      setTasks(tasksData);

      if (tx) {
        const agentsData = await agentsRes.json();
        const agent = agentsData.find((a: Agent) => a.id === tx.agent_id);
        setAgentName(agent?.name || 'Unknown');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      fetchData();
    } catch (error) {
      console.error('Error toggling task:', error);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!transaction) return <div className="p-8">Transaction not found</div>;

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/transactions" className="text-blue-400 hover:underline mb-8 inline-block">
          ← Back to Transactions
        </Link>

        <div className="bg-gray-800 rounded-lg p-8 mb-8">
          <h1 className="text-4xl font-bold mb-6">{transaction.file_number}</h1>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-gray-400 text-sm">Agent</p>
              <p className="text-xl font-semibold">{agentName}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Property</p>
              <p className="text-xl font-semibold">{transaction.property_address}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Purchase Price</p>
              <p className="text-xl font-semibold">${transaction.purchase_price.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Status</p>
              <p className="text-xl font-semibold">{transaction.status}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-8">
          <h2 className="text-2xl font-bold mb-6">Task Checklist</h2>
          <p className="text-gray-400 mb-6">
            {completedCount} of {tasks.length} completed
          </p>

          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center p-4 bg-gray-700 rounded">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => handleToggleTask(task.id)}
                  className="w-5 h-5 mr-4 cursor-pointer"
                />
                <span className={task.completed ? 'line-through text-gray-500' : ''}>
                  {task.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
