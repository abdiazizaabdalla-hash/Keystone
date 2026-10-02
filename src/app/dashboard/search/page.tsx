'use client';

import { useRef, useState } from 'react';
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

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (q: string) => {
    try {
      const res = await authFetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Search failed');
      }
      setResults(Array.isArray(data.results) ? data.results : []);
      setError(null);
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
            placeholder="Search transactions, messages, documents, tasks..."
            autoFocus
            className="w-full pl-12 pr-4 py-4 bg-slate-700/50 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
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
