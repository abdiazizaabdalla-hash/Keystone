'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface AgentTransaction {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  status: string;
  tcLabel: string;
}

// The whole point of one login across every TC that's added this agent:
// this list is the union of every transaction_agents row for them,
// regardless of which TC/brokerage it came from (see
// GET /api/agent/transactions).
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <img src="/relay-icon.png" alt="Relay TC" className="w-10 h-10 object-contain" />
          <h1 className="text-2xl font-display font-semibold text-slate-100">Your deals</h1>
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
          <div className="space-y-3">
            {transactions.map((t) => (
              <Link
                key={t.id}
                href={`/agent/transactions/${t.id}`}
                className="flex items-center justify-between gap-4 bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 hover:border-blue-500 rounded-lg px-5 py-4 transition"
              >
                <div>
                  <p className="text-slate-100 font-semibold">{t.propertyAddress || t.fileNumber}</p>
                  <p className="text-slate-500 text-xs mt-0.5">Coordinated by {t.tcLabel}</p>
                </div>
                <span className="text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-full px-3 py-1 shrink-0">
                  {t.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
