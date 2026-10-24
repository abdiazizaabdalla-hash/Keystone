'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

interface Transaction {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  created_at: string;
  acceptance_date?: string | null;
  closing_date?: string | null;
  checklist_template_name?: string | null;
  /** Earliest incomplete task's due_date across this deal's checklist, or null. */
  next_due_date?: string | null;
  /** How many incomplete tasks on this deal are already past their due_date. */
  overdue_count?: number;
  tasks_total?: number;
  tasks_done?: number;
  /** 'quickbooks' when the deal was created by a QuickBooks import. */
  source?: string | null;
}

// Deals saved by the QuickBooks import (also recognised before the source column exists: closed, named after an invoice number).
const isQb = (t: Transaction) => t.source === 'quickbooks' || (t.source == null && t.status === 'Closed' && /^(QB|RELAY)-/i.test(t.file_number || ''));

interface Agent {
  id: string;
  name: string;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agents, setAgents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'active' | 'attention' | 'closed' | 'quickbooks' | 'all'>('active');
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [txRes, agentsRes] = await Promise.all([
        authFetch('/api/transactions'),
        authFetch('/api/agents'),
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
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error fetching data:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Color-coded due-date flag for the list -- overdue wins over
  // due-soon, and a Closed deal never shows one (nothing left to chase).
  const getDueBadge = (tx: Transaction) => {
    if (tx.status === 'Closed') {
      return <span className="text-xs text-slate-600">—</span>;
    }
    if (tx.overdue_count && tx.overdue_count > 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-900/30 border border-red-700 text-red-400 whitespace-nowrap">
          {tx.overdue_count} overdue
        </span>
      );
    }
    if (!tx.next_due_date) {
      return <span className="text-xs text-slate-600">—</span>;
    }
    const todayStr = new Date().toISOString().split('T')[0];
    if (tx.next_due_date === todayStr) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/30 border border-amber-700 text-amber-400 whitespace-nowrap">
          Due today
        </span>
      );
    }
    const daysDiff = Math.round(
      (new Date(`${tx.next_due_date}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) /
        (24 * 60 * 60 * 1000)
    );
    if (daysDiff > 0 && daysDiff <= 3) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-900/10 border border-amber-800/60 text-amber-300 whitespace-nowrap">
          Due in {daysDiff}d
        </span>
      );
    }
    return <span className="text-xs text-slate-500 whitespace-nowrap">Due {formatDisplayDate(tx.next_due_date)}</span>;
  };

  const searching = query.trim().length > 0;

  const STATUS_STYLE: Record<string, string> = {
    Closed: 'bg-green-500/10 text-green-300 border-green-500/40',
    'Under Contract': 'bg-blue-500/15 text-blue-300 border-blue-500/50',
    'Contract Pending': 'bg-amber-500/10 text-amber-300 border-amber-500/40',
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dueKey = (t: Transaction) => t.next_due_date || '9999-12-31';
    return transactions
      .filter((tx) => {
        const isClosed = tx.status === 'Closed';
        const qb = isQb(tx);
        // QuickBooks imports have their own filter; the everyday views leave them out (All shows everything).
        if (view === 'quickbooks' ? !qb : view !== 'all' && qb) return false;
        if (view === 'active' && isClosed) return false;
        if (view === 'closed' && !isClosed) return false;
        if (view === 'attention' && (isClosed || !(tx.overdue_count && tx.overdue_count > 0))) return false;
        if (!q) return true;
        const agentName = agents.get(tx.agent_id) || '';
        return `${agentName} ${tx.property_address || ''} ${tx.file_number || ''} ${tx.status || ''} ${qb ? 'quickbooks' : ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const ac = a.status === 'Closed';
        const bc = b.status === 'Closed';
        if (ac !== bc) return ac ? 1 : -1;
        if (ac) return (b.closing_date || b.created_at).localeCompare(a.closing_date || a.created_at);
        return dueKey(a).localeCompare(dueKey(b)) || b.created_at.localeCompare(a.created_at);
      });
  }, [transactions, agents, query, view]);

  const totals = useMemo(() => {
    const own = transactions.filter((t) => !isQb(t));
    const active = own.filter((t) => t.status !== 'Closed');
    return {
      all: transactions.length,
      active: active.length,
      closed: own.length - active.length,
      overdue: active.filter((t) => (t.overdue_count || 0) > 0).length,
      quickbooks: transactions.length - own.length,
    };
  }, [transactions]);

  if (loading) {
    return (
      <div className="p-4 md:p-10 max-w-5xl mx-auto">
        <p className="text-slate-400">Loading transactions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-10 max-w-5xl mx-auto">
        <div className="bg-red-900/30 border border-red-700 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Transactions</h2>
          <p className="text-red-200 mb-4">{error}</p>
          <p className="text-red-300 text-sm">
            💡 If you see &quot;permission denied&quot;, run the Supabase SQL grant statements in your Supabase dashboard.
          </p>
        </div>
      </div>
    );
  }

  const filters: { id: typeof view; label: string }[] = [
    { id: 'active', label: `Open (${totals.active})` },
    ...(totals.overdue > 0 ? [{ id: 'attention' as const, label: `Needs attention (${totals.overdue})` }] : []),
    { id: 'closed', label: `Closed (${totals.closed})` },
    ...(totals.quickbooks > 0 ? [{ id: 'quickbooks' as const, label: `QuickBooks (${totals.quickbooks})` }] : []),
    { id: 'all', label: 'All' },
  ];

  return (
    <div className="p-4 md:p-10 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-slate-100 mb-1">Transactions</h1>
          <p className="text-slate-400">Every deal from contract to closing, with the next step due.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/transactions/import" className="hidden sm:inline text-sm text-slate-400 hover:text-slate-200">
            Import CSV
          </Link>
          <Link
            href="/dashboard/transactions/new"
            className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition whitespace-nowrap"
          >
            + New deal
          </Link>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-slate-300 mb-1">No transactions yet.</p>
          <p className="text-sm text-slate-500 mb-5">Start a deal when a contract is accepted. Relay adds the checklist and counts the days to closing.</p>
          <Link href="/dashboard/transactions/new" className="inline-block px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition">
            Create your first deal
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm" role="tablist" aria-label="Show transactions">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={view === f.id}
                  onClick={() => setView(f.id)}
                  className={`px-3 py-1.5 rounded-full border transition ${
                    view === f.id
                      ? 'border-blue-500 text-blue-300 bg-blue-900/20'
                      : f.id === 'attention'
                        ? 'border-red-500/40 text-red-300 hover:text-red-200'
                        : 'border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agent, address or file number"
              aria-label="Search transactions"
              className="flex-1 min-w-[12rem] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {visible.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <p className="text-slate-300 mb-1">
                {searching ? `Nothing matches “${query.trim()}”` : view === 'attention' ? 'Nothing is overdue.' : view === 'closed' ? 'No closed transactions yet.' : view === 'quickbooks' ? 'Nothing has been imported from QuickBooks.' : 'No open transactions.'}
              </p>
              {(searching || view !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setView('all');
                  }}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  Show everything
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              {visible.map((tx) => {
                const total = tx.tasks_total ?? 0;
                const done = tx.tasks_done ?? 0;
                const pct = total ? Math.round((done / total) * 100) : 0;
                const closed = tx.status === 'Closed';
                const agentName = agents.get(tx.agent_id);
                const price = tx.purchase_price ? `$${Number(tx.purchase_price).toLocaleString()}` : null;
                return (
                  <Link
                    key={tx.id}
                    href={`/dashboard/transactions/${tx.id}`}
                    className="block bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-5 transition"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-semibold break-words ${closed ? 'text-slate-400' : 'text-slate-100'}`}>{tx.property_address || 'No address'}</p>
                        <p className="text-xs text-slate-500">
                          {[agentName && `Agent: ${agentName}`, tx.file_number && `File ${tx.file_number}`, price].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isQb(tx) && <span className="rounded-full border border-emerald-600/50 bg-emerald-900/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">QuickBooks</span>}
                        <span className={`text-xs px-2.5 py-0.5 rounded-full border ${STATUS_STYLE[tx.status] || 'bg-slate-500/10 text-slate-300 border-slate-500/40'}`}>{tx.status}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                      {total > 0 && (
                        <>
                          <span>
                            {done}/{total} steps done
                          </span>
                          <span className="w-28 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden>
                            <span className="block h-full bg-blue-500" style={{ width: `${pct}%` }} />
                          </span>
                        </>
                      )}
                      {tx.closing_date && <span>{closed ? 'Closed' : 'Closing'} {formatDisplayDate(tx.closing_date)}</span>}
                      {!closed && getDueBadge(tx)}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
