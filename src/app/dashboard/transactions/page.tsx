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
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'active' | 'attention' | 'closed' | 'all'>('active');
  // Which agent groups are folded away, which "Closed" lists are open, and which deals are expanded.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [closedOpen, setClosedOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const flip = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this transaction? This also removes its checklist, uploaded documents, and any invoice generated from it. This cannot be undone.')) {
      return;
    }

    try {
      setDeletingId(id);
      const response = await authFetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete transaction');
      }
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      alert(error instanceof Error ? error.message : 'Failed to delete transaction');
    } finally {
      setDeletingId(null);
    }
  };

  const searching = query.trim().length > 0;

  // Deals grouped by agent, each split into active and closed. Agents with active deals come first, then A to Z.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byAgent = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const isClosed = tx.status === 'Closed';
      if (view === 'active' && isClosed) continue;
      if (view === 'closed' && !isClosed) continue;
      if (view === 'attention' && (isClosed || !(tx.overdue_count && tx.overdue_count > 0))) continue;
      const agentName = agents.get(tx.agent_id) || 'Unknown agent';
      if (q && !`${agentName} ${tx.property_address || ''} ${tx.file_number || ''} ${tx.status || ''}`.toLowerCase().includes(q)) continue;
      const list = byAgent.get(tx.agent_id) || [];
      list.push(tx);
      byAgent.set(tx.agent_id, list);
    }
    const dueKey = (t: Transaction) => t.next_due_date || '9999-12-31';
    return [...byAgent.entries()]
      .map(([agentId, list]) => {
        const active = list.filter((t) => t.status !== 'Closed').sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || b.created_at.localeCompare(a.created_at));
        const closed = list.filter((t) => t.status === 'Closed').sort((a, b) => (b.closing_date || b.created_at).localeCompare(a.closing_date || a.created_at));
        return { agentId, name: agents.get(agentId) || 'Unknown agent', active, closed, overdue: active.reduce((n, t) => n + (t.overdue_count || 0), 0) };
      })
      .sort((a, b) => Number(b.active.length > 0) - Number(a.active.length > 0) || a.name.localeCompare(b.name));
  }, [transactions, agents, query, view]);

  const totals = useMemo(() => {
    const active = transactions.filter((t) => t.status !== 'Closed');
    return { all: transactions.length, active: active.length, closed: transactions.length - active.length, overdue: active.filter((t) => (t.overdue_count || 0) > 0).length };
  }, [transactions]);


  if (loading) {
    return (
      <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading transactions...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Transactions</h2>
            <p className="text-red-200 mb-4">{error}</p>
            <p className="text-red-300 text-sm">
              💡 If you see "permission denied", run the Supabase SQL grant statements in your Supabase dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'Closed':
        return 'bg-green-400';
      case 'Contract Pending':
        return 'bg-yellow-400';
      case 'Under Contract':
        return 'bg-blue-400';
      default:
        return 'bg-slate-400';
    }
  };

  const renderDeal = (tx: Transaction) => {
    const open = expanded.has(tx.id);
    const closed = tx.status === 'Closed';
    const price = tx.purchase_price ? `$${Number(tx.purchase_price).toLocaleString()}` : '—';
    return (
      <li key={tx.id} className="border-t border-slate-700/60 first:border-t-0">
        <div className="flex items-center hover:bg-slate-700/30 transition">
          <Link href={`/dashboard/transactions/${tx.id}`} className="flex-1 min-w-0 flex items-center gap-3 pl-4 py-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(tx.status)}`} title={tx.status} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-medium ${closed ? 'text-slate-400' : 'text-slate-100'}`}>{tx.property_address || 'No address'}</span>
              <span className="block truncate text-xs text-slate-500">
                {tx.status}
                {tx.file_number ? ` · File ${tx.file_number}` : ''}
              </span>
            </span>
            <span className="hidden sm:block shrink-0">{getDueBadge(tx)}</span>
          </Link>
          <button
            type="button"
            onClick={() => flip(setExpanded, tx.id)}
            aria-expanded={open}
            aria-controls={`deal-${tx.id}`}
            aria-label={open ? 'Hide details' : 'Show details'}
            className="shrink-0 px-4 py-3 text-slate-500 hover:text-slate-200 transition"
          >
            <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {open && (
          <div id={`deal-${tx.id}`} className="pb-4 pl-9 pr-4">
            <div className="sm:hidden mb-2">{getDueBadge(tx)}</div>
            <dl className="grid gap-x-8 gap-y-3 text-sm grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Price</dt>
                <dd className="mt-0.5 font-semibold text-blue-400">{price}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Accepted</dt>
                <dd className="mt-0.5 text-slate-200">{tx.acceptance_date ? formatDisplayDate(tx.acceptance_date) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Closing</dt>
                <dd className="mt-0.5 text-slate-200">{tx.closing_date ? formatDisplayDate(tx.closing_date) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Next step due</dt>
                <dd className="mt-0.5 text-slate-200">{!closed && tx.next_due_date ? formatDisplayDate(tx.next_due_date) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">File number</dt>
                <dd className="mt-0.5 font-mono text-slate-200 break-all">{tx.file_number || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Checklist</dt>
                <dd className="mt-0.5 text-slate-200 break-words">{tx.checklist_template_name || 'Baseline'}</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center gap-4">
              <Link href={`/dashboard/transactions/${tx.id}`} className="text-sm font-medium text-blue-400 hover:text-blue-300">
                Open transaction →
              </Link>
              <button
                onClick={(e) => handleDelete(e, tx.id)}
                disabled={deletingId === tx.id}
                className="text-sm text-slate-500 hover:text-red-400 transition disabled:opacity-50"
              >
                {deletingId === tx.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const tabs: { id: typeof view; label: string; count: number }[] = [
    { id: 'active', label: 'Active', count: totals.active },
    ...(totals.overdue > 0 ? [{ id: 'attention' as const, label: 'Needs attention', count: totals.overdue }] : []),
    { id: 'closed', label: 'Closed', count: totals.closed },
    { id: 'all', label: 'All', count: totals.all },
  ];

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-3xl md:text-4xl font-display font-semibold text-slate-100">Transactions</h1>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/dashboard/transactions/import"
              className="hidden sm:inline-block text-sm text-slate-300 hover:text-slate-100 border border-slate-600 hover:border-slate-500 rounded-lg px-4 py-2.5 transition whitespace-nowrap"
            >
              Import CSV
            </Link>
            <Link
              href="/dashboard/transactions/new"
              className="shrink-0 px-4 py-2.5 md:px-5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition shadow-lg whitespace-nowrap"
            >
              + New Deal
            </Link>
          </div>
        </div>

        {/* Empty State */}
        {transactions.length === 0 ? (
          <div className="bg-slate-700/50 border border-dashed border-slate-600 rounded-lg p-8 md:p-16 text-center">
            <div className="w-16 h-16 bg-slate-600/50 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No transactions yet</h3>
            <p className="text-slate-400 mb-6">Start by creating your first deal to get organized</p>
            <Link
              href="/dashboard/transactions/new"
              className="inline-block px-6 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg transition hover:shadow-lg"
            >
              Create Your First Deal
            </Link>
          </div>
        ) : (
          <>
            {/* One row of controls: what to show, and search. */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-slate-600 bg-slate-800/60 p-0.5" role="tablist" aria-label="Show transactions">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={view === t.id}
                    onClick={() => setView(t.id)}
                    className={`px-3 py-1.5 text-sm rounded-md transition whitespace-nowrap ${
                      view === t.id ? 'bg-slate-600 text-white font-medium' : t.id === 'attention' ? 'text-red-300 hover:text-red-200' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.label} <span className="text-xs opacity-70">{t.count}</span>
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[12rem]">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search agent, address or file number"
                  aria-label="Search transactions"
                  className="w-full bg-slate-700/60 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {groups.length === 0 ? (
              <div className="bg-slate-700/40 border border-slate-600 rounded-lg p-10 text-center">
                <p className="text-slate-300 font-medium">
                  {searching ? `Nothing matches “${query.trim()}”` : view === 'attention' ? 'Nothing is overdue.' : view === 'closed' ? 'No closed transactions yet.' : 'No active transactions.'}
                </p>
                {(searching || view !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setView('all');
                    }}
                    className="mt-2 text-sm text-blue-400 hover:text-blue-300"
                  >
                    Show everything
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {groups.map((g) => {
                  const isFolded = !searching && folded.has(g.agentId);
                  const showClosed = searching || view === 'closed' || closedOpen.has(g.agentId);
                  return (
                    <section key={g.agentId}>
                      <button
                        type="button"
                        onClick={() => flip(setFolded, g.agentId)}
                        aria-expanded={!isFolded}
                        className="w-full flex items-center gap-3 px-1 pb-2 text-left group"
                      >
                        <span className="w-7 h-7 shrink-0 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">
                          {(g.name[0] || '?').toUpperCase()}
                        </span>
                        <span className="font-semibold text-slate-100 truncate">{g.name}</span>
                        <span className="text-xs text-slate-500">
                          {g.active.length > 0 ? `${g.active.length} active` : ''}
                          {g.active.length > 0 && g.closed.length > 0 ? ' · ' : ''}
                          {g.closed.length > 0 ? `${g.closed.length} closed` : ''}
                        </span>
                        {g.overdue > 0 && <span className="text-xs font-medium text-red-400">{g.overdue} overdue</span>}
                        <svg className={`ml-auto h-4 w-4 shrink-0 text-slate-600 group-hover:text-slate-400 transition-transform ${isFolded ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {!isFolded && (
                        <div className="rounded-xl border border-slate-600 bg-slate-800/40 overflow-hidden">
                          {g.active.length > 0 && <ul>{g.active.map(renderDeal)}</ul>}

                          {g.closed.length > 0 && (
                            <div className={g.active.length > 0 ? 'border-t border-slate-700' : ''}>
                              {view !== 'closed' && (
                                <button
                                  type="button"
                                  onClick={() => flip(setClosedOpen, g.agentId)}
                                  aria-expanded={showClosed}
                                  className="w-full flex items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-slate-500 hover:text-slate-300 transition"
                                >
                                  <span>
                                    {showClosed ? 'Hide' : 'Show'} {g.closed.length} closed
                                  </span>
                                  <svg className={`h-3.5 w-3.5 transition-transform ${showClosed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              )}
                              {showClosed && <ul className={view !== 'closed' ? 'border-t border-slate-700/60' : ''}>{g.closed.map(renderDeal)}</ul>}
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
