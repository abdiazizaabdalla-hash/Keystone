'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface MemberTransaction {
  id: string;
  agent_id: string;
  agent_name: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  created_at: string;
}

interface MemberTransactionsResponse {
  member: { userId: string; email: string; name: string };
  active: MemberTransaction[];
  closed: MemberTransaction[];
}

function getStatusColor(status: string) {
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
}

function TransactionTable({ rows }: { rows: MemberTransaction[] }) {
  if (rows.length === 0) {
    return <p className="px-6 py-8 text-sm text-slate-500 text-center">Nothing here yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-600 bg-slate-800/50">
            <th className="px-6 py-3 text-left">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</span>
            </th>
            <th className="px-6 py-3 text-left">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">File #</span>
            </th>
            <th className="px-6 py-3 text-left">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</span>
            </th>
            <th className="px-6 py-3 text-left">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Price</span>
            </th>
            <th className="px-6 py-3 text-left">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tx, index) => (
            <tr key={tx.id} className={`border-b border-slate-600/50 ${index % 2 === 0 ? 'bg-slate-700/20' : ''}`}>
              <td className="px-6 py-3 text-slate-200">{tx.agent_name}</td>
              <td className="px-6 py-3 font-mono text-sm text-slate-300">{tx.file_number}</td>
              <td className="px-6 py-3 text-slate-300 max-w-xs truncate">{tx.property_address}</td>
              <td className="px-6 py-3 font-semibold text-blue-400">
                ${Number(tx.purchase_price || 0).toLocaleString()}
              </td>
              <td className="px-6 py-3">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                    tx.status
                  )}`}
                >
                  {tx.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TeammateTransactionsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MemberTransactionsResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/api/team/${userId}/transactions`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load this teammate's transactions");
        setData(json);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/auth');
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load this teammate's transactions");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Link href="/dashboard/collaborate" className="text-sm text-blue-400 hover:text-blue-300">
          ‹ Back to team
        </Link>
        <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const displayName = data.member.name || data.member.email;

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/dashboard/collaborate" className="text-sm text-blue-400 hover:text-blue-300">
        ‹ Back to team
      </Link>
      <h1 className="text-3xl font-display font-semibold text-slate-100 mt-3 mb-1">{displayName}</h1>
      <p className="text-slate-400 mb-8">{data.member.email}</p>

      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-600 flex items-center justify-between">
          <h2 className="font-display font-semibold text-slate-100">Active transactions</h2>
          <span className="text-xs text-slate-400">{data.active.length}</span>
        </div>
        <TransactionTable rows={data.active} />
      </div>

      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-600 flex items-center justify-between">
          <h2 className="font-display font-semibold text-slate-100">Closed transactions</h2>
          <span className="text-xs text-slate-400">{data.closed.length}</span>
        </div>
        <TransactionTable rows={data.closed} />
      </div>
    </div>
  );
}
