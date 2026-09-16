'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Transaction {
  id: string;
  agentName: string;
  fileNumber: string;
  propertyAddress: string;
  purchasePrice: number;
  status: string;
}

interface Task {
  id: string;
  transactionId: string;
  name: string;
  completed: boolean;
}

export default function TransactionDetailPage({ params }: { params: { id: string } }) {
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [params.id]);

  const fetchData = async () => {
    try {
      const txRes = await fetch('/api/transactions');
      const allTx = await txRes.json();
      const tx = allTx.find((t: Transaction) => t.id === params.id);
      setTransaction(tx || null);

      const tasksRes = await fetch(`/api/tasks?transactionId=${params.id}`);
      const txTasks = await tasksRes.json();
      setTasks(txTasks);
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
          <h1 className="text-4xl font-bold mb-6">{transaction.fileNumber}</h1>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-gray-400 text-sm">Agent</p>
              <p className="text-xl font-semibold">{transaction.agentName}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Property</p>
              <p className="text-xl font-semibold">{transaction.propertyAddress}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Purchase Price</p>
              <p className="text-xl font-semibold">${transaction.purchasePrice.toLocaleString()}</p>
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
