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
  createdAt: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const res = await fetch('/api/transactions');
      const data = await res.json();
      setTransactions(data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

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
                  >
                    <td
                      className="px-6 py-3"
                      onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                    >
                      {tx.agentName}
                    </td>
                    <td
                      className="px-6 py-3"
                      onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                    >
                      {tx.fileNumber}
                    </td>
                    <td
                      className="px-6 py-3"
                      onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                    >
                      {tx.propertyAddress}
                    </td>
                    <td
                      className="px-6 py-3"
                      onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                    >
                      ${tx.purchasePrice.toLocaleString()}
                    </td>
                    <td
                      className="px-6 py-3"
                      onClick={() => (window.location.href = `/transactions/${tx.id}`)}
                    >
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
