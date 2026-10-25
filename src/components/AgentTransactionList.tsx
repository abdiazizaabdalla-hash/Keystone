'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDisplayDate } from '@/lib/dueDates';

export interface AgentTransaction {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  status: string;
  tcUserId: string;
  tcLabel: string;
  nextDueDate: string | null;
  overdueCount: number;
  addedAt?: string | null;
  isNew?: boolean;
  fromListingId?: string | null;
}

// Same status colors as the TC's own transactions list, as a small pill.
export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Closed'
      ? 'bg-green-900/30 border-green-800 text-green-300'
      : status === 'Contract Pending'
        ? 'bg-yellow-900/20 border-yellow-800/70 text-yellow-300'
        : status === 'Under Contract'
          ? 'bg-blue-900/30 border-blue-800 text-blue-300'
          : 'bg-slate-700/60 border-slate-600 text-slate-300';
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${tone}`}>{status}</span>;
}

// Same due-date flag logic as the TC list -- overdue wins, Closed shows
// nothing, otherwise "Due today" / "Due in Nd" / a plain date.
export const getDueBadge = (tx: AgentTransaction) => {
  if (tx.status === 'Closed') {
    return <span className="text-xs text-slate-600">—</span>;
  }
  if (tx.overdueCount > 0) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-900/30 border border-red-700 text-red-400 whitespace-nowrap">
        {tx.overdueCount} overdue
      </span>
    );
  }
  if (!tx.nextDueDate) {
    return <span className="text-xs text-slate-600">—</span>;
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (tx.nextDueDate === todayStr) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/30 border border-amber-700 text-amber-400 whitespace-nowrap">
        Due today
      </span>
    );
  }
  const daysDiff = Math.round(
    (new Date(`${tx.nextDueDate}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (daysDiff > 0 && daysDiff <= 3) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/10 border border-amber-800/60 text-amber-300 whitespace-nowrap">
        Due in {daysDiff}d
      </span>
    );
  }
  return <span className="text-xs text-slate-500 whitespace-nowrap">Due {formatDisplayDate(tx.nextDueDate)}</span>;
};

// The agent's deals: one card per deal on phones, one clean table on larger screens. Used by the dashboard and the Transactions page.
export default function AgentTransactionList({ transactions, multiTc }: { transactions: AgentTransaction[]; multiTc: boolean }) {
  const router = useRouter();
  // Needs attention first (overdue, then soonest due), closed deals last.
  const sortedTransactions = [...transactions].sort((x, y) => {
    const rank = (t: AgentTransaction) => (t.status === 'Closed' ? 3 : t.overdueCount > 0 ? 0 : t.nextDueDate ? 1 : 2);
    return rank(x) - rank(y) || (x.nextDueDate || '9999').localeCompare(y.nextDueDate || '9999') || (x.propertyAddress || '').localeCompare(y.propertyAddress || '');
  });
  return (
    <>
            {/* Phones: one card per deal */}
            <div className="md:hidden space-y-3">
              {sortedTransactions.map((tx) => (
                <Link
                  key={tx.id}
                  href={`/agent/transactions/${tx.id}`}
                  className="block bg-white/5 border border-white/10 rounded-2xl p-4 active:bg-slate-700/40 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-slate-100 font-semibold leading-snug break-words">{tx.propertyAddress || tx.fileNumber}</p>
                    <StatusPill status={tx.status} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mt-3">
                    <span className="font-mono text-xs text-slate-500">File {tx.fileNumber}</span>
                    <span>{getDueBadge(tx)}</span>
                  </div>
                  {multiTc && <p className="text-xs text-slate-500 mt-2">{tx.tcLabel}</p>}
                </Link>
              ))}
            </div>

            {/* Tablets and desktop: one clean table */}
            <div className="hidden md:block bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">File #</th>
                    {multiTc && <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Coordinator</th>}
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-slate-700/60 last:border-0 hover:bg-slate-700/30 cursor-pointer transition"
                      onClick={() => router.push(`/agent/transactions/${tx.id}`)}
                    >
                      <td className="px-5 py-3.5">
                        <span className="text-slate-100 font-medium block max-w-md truncate">{tx.propertyAddress || tx.fileNumber}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-sm text-slate-400">{tx.fileNumber}</span>
                      </td>
                      {multiTc && (
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-slate-300">{tx.tcLabel}</span>
                        </td>
                      )}
                      <td className="px-5 py-3.5">
                        <StatusPill status={tx.status} />
                      </td>
                      <td className="px-5 py-3.5">{getDueBadge(tx)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
    </>
  );
}
