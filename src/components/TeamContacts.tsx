'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import type { ContactRow } from '@/lib/contactsCrm';
import ContactEditModal from '@/components/ContactEditModal';
import SyncContactsModal from '@/components/SyncContactsModal';

const inputCls =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

type Who = 'all' | 'mine' | 'teammates';

// The team's shared address book: every contact a teammate (or you) chose to share. Everything
// else stays personal on the Contacts page. Open a contact for its full profile.
export default function TeamContacts({ onLoaded }: { onLoaded?: (shared: ContactRow[]) => void }) {
  const router = useRouter();
  const [all, setAll] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [who, setWho] = useState<Who>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/contacts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
      setAll(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const shared = useMemo(() => all.filter((c) => c.team_id), [all]);
  useEffect(() => {
    onLoaded?.(shared);
  }, [shared, onLoaded]);

  const tags = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of shared) for (const t of c.tags || []) map.set(t.toLowerCase(), t);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [shared]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shared.filter((c) => {
      if (who === 'mine' && c.is_mine === false) return false;
      if (who === 'teammates' && c.is_mine !== false) return false;
      if (tag && !(c.tags || []).some((t) => t.toLowerCase() === tag)) return false;
      if (!q) return true;
      return [c.name, c.email, c.phone, c.company, c.role, c.shared_by_name, ...(c.tags || [])].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [shared, search, who, tag]);

  if (loading) return <p className="text-slate-400">Loading team contacts…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <p className="text-sm text-slate-400 max-w-xl">
          Contacts you and your teammates chose to share. Everyone on the team can see and edit these details; notes and follow-ups stay private to whoever wrote them. Your other contacts stay personal on the{' '}
          <Link href="/dashboard/contacts" className="text-blue-400 hover:text-blue-300">
            Contacts page
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSyncing(true)} className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">
            Sync contacts
          </button>
          <button type="button" onClick={() => setAdding(true)} className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
            + Add shared contact
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, company, tag…" className={`${inputCls} max-w-sm`} />
        <select value={who} onChange={(e) => setWho(e.target.value as Who)} className={`${inputCls} w-auto`} aria-label="Shared by">
          <option value="all">Everyone&rsquo;s</option>
          <option value="mine">Shared by me</option>
          <option value="teammates">Shared by teammates</option>
        </select>
        {tags.length > 0 && (
          <select value={tag || ''} onChange={(e) => setTag(e.target.value || null)} className={`${inputCls} w-auto`} aria-label="Tag">
            <option value="">All tags</option>
            {tags.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>

      {shared.length === 0 ? (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center">
          <p className="text-slate-200 font-semibold mb-1">No shared contacts yet</p>
          <p className="text-slate-400 text-sm mb-5">Share the contacts your whole team works with, like preferred lenders, title companies and inspectors. Use Sync to share many at once.</p>
          <button type="button" onClick={() => setSyncing(true)} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg">
            Sync contacts
          </button>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-700">
                <th className="px-4 py-3">Name</th>
                <th className="px-2 py-3">Email / phone</th>
                <th className="px-2 py-3">Tags</th>
                <th className="px-2 py-3">Shared by</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button')) return;
                    router.push(`/dashboard/contacts/${c.id}`);
                  }}
                  className="border-b border-slate-700/60 last:border-0 hover:bg-slate-700/20 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contacts/${c.id}`} className="text-slate-100 font-medium break-words hover:text-blue-300">
                      {c.name || c.email}
                    </Link>
                    {c.contact_type === 'organization' && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-slate-600 text-slate-400">Org</span>}
                    <p className="text-xs text-slate-500 break-words">{[c.role, c.company].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-2 py-3 text-slate-300">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-blue-400 hover:text-blue-300 break-all">
                        {c.email}
                      </a>
                    )}
                    {c.phone && <p className="text-xs text-slate-500">{c.phone}</p>}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags || []).map((t) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-slate-400 text-xs">{c.is_mine === false ? c.shared_by_name || 'A teammate' : 'You'}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No shared contacts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <ContactEditModal
          contact={null}
          organizations={all.filter((c) => c.contact_type === 'organization')}
          hasTeam
          defaults={{ shared: true }}
          onClose={() => setAdding(false)}
          onAuthError={handleAuth}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
      {syncing && (
        <SyncContactsModal
          tags={[...new Set(all.filter((c) => c.is_mine !== false).flatMap((c) => c.tags || []))].sort()}
          onClose={() => setSyncing(false)}
          onDone={load}
          onAuthError={handleAuth}
        />
      )}
    </div>
  );
}
