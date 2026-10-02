'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

type SearchResultType = 'transaction' | 'message' | 'document' | 'task';

interface SearchResult {
  type: SearchResultType;
  id: string;
  transactionId: string;
  propertyAddress: string | null;
  fileNumber: string | null;
  title: string;
  snippet: string | null;
  createdAt: string | null;
}

const TYPE_LABELS: Record<SearchResultType, string> = {
  transaction: 'Transactions',
  message: 'Messages',
  document: 'Documents',
  task: 'Tasks',
};

const TYPE_ORDER: SearchResultType[] = ['transaction', 'message', 'document', 'task'];

function dealLabel(result: SearchResult): string {
  return result.propertyAddress || result.fileNumber || 'Untitled deal';
}

// Recent searches are a per-browser convenience, not account data -- kept
// in localStorage only (same pattern as the sidebar's collapsed state in
// dashboard/layout.tsx), never sent to the server. Capped at 8 so the
// dropdown stays short.
const RECENT_SEARCHES_KEY = 'relaytc_recent_searches';
const MAX_RECENT_SEARCHES = 8;

function loadRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((q) => typeof q === 'string') : [];
  } catch {
    // localStorage can throw in some private-browsing modes -- recents
    // just won't persist, which is harmless.
    return [];
  }
}

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showRecents, setShowRecents] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Deferred a tick past mount (same pattern as the sidebar's
    // collapsed-state init in dashboard/layout.tsx) so the client's
    // first render matches the server-rendered markup before this reads
    // client-only state, and so the setState below isn't a synchronous
    // call in the effect body (react-hooks/set-state-in-effect).
    const init = async () => {
      await Promise.resolve();
      setRecentSearches(loadRecentSearches());
    };
    init();
  }, []);

  const saveRecentSearch = (q: string) => {
    setRecentSearches((prev) => {
      const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
      try {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // Non-critical -- the list just won't persist across reloads.
      }
      return next;
    });
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Non-critical.
    }
  };

  const runSearch = async (q: string) => {
    try {
      const res = await authFetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Search failed');
      }
      setResults(Array.isArray(data.results) ? data.results : []);
      setError(null);
      saveRecentSearch(q);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setResults([]);
    } finally {
      setSearched(true);
      setLoading(false);
    }
  };

  // Debounced on every keystroke rather than via a `[query]` effect --
  // keeps all the setState calls inside an event handler instead of an
  // effect body, which React's hooks lint (react-hooks/set-state-in-effect)
  // flags as a cascading-render risk.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setShowRecents(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      runSearch(trimmed);
    }, 300);
  };

  const handleFocus = () => {
    if (query.trim().length === 0 && recentSearches.length > 0) {
      setShowRecents(true);
    }
  };

  const handleSelectRecent = (q: string) => {
    setQuery(q);
    setShowRecents(false);
    setLoading(true);
    runSearch(q);
  };

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    items: results.filter((r) => r.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-display font-semibold text-slate-100 mb-2">Search</h1>
        <p className="text-slate-400 mb-8">
          Find a deal by address or file number, or search inside messages, documents, and tasks.
        </p>

        <div className="relative mb-8">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={() => setShowRecents(false)}
            placeholder="Search transactions, messages, documents, tasks..."
            autoFocus
            autoComplete="off"
            className="w-full pl-12 pr-4 py-4 bg-slate-700/50 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          {showRecents && recentSearches.length > 0 && (
            // onMouseDown (not onClick) + preventDefault on the container
            // keeps the input from blurring when a row is clicked -- a
            // blur would otherwise fire first and close this dropdown
            // before the click on an item inside it ever registers.
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="absolute left-0 right-0 top-full mt-2 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden z-10"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recent</span>
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  className="text-xs text-slate-500 hover:text-slate-300 transition"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSelectRecent(q)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-700/50 transition"
                >
                  <svg className="w-4 h-4 text-slate-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 4a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-slate-200 truncate">{q}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-400 mb-6">{error}</div>
        )}

        {loading && <div className="text-slate-400 text-center py-12">Searching...</div>}

        {!loading && searched && grouped.length === 0 && !error && (
          <div className="bg-slate-700/50 border border-dashed border-slate-600 rounded-lg p-16 text-center">
            <p className="text-slate-400">No results for &ldquo;{query.trim()}&rdquo;.</p>
          </div>
        )}

        {!loading && !searched && query.trim().length > 0 && query.trim().length < 2 && (
          <p className="text-slate-500 text-sm">Keep typing -- at least 2 characters.</p>
        )}

        {!loading &&
          grouped.map((group) => (
            <div key={group.type} className="mb-8">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                {TYPE_LABELS[group.type]} ({group.items.length})
              </h2>
              <div className="bg-slate-700/30 border border-slate-600 rounded-lg divide-y divide-slate-600/50 overflow-hidden">
                {group.items.map((item) => (
                  <Link
                    key={`${item.type}-${item.id}`}
                    href={`/dashboard/transactions/${item.transactionId}`}
                    className="block px-5 py-4 hover:bg-slate-600/30 transition"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-slate-100 font-medium truncate">{item.title}</p>
                        {item.snippet && (
                          <p className="text-slate-400 text-sm truncate mt-0.5">{item.snippet}</p>
                        )}
                        <p className="text-slate-500 text-xs mt-1">{dealLabel(item)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
