'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Target {
  id: string;
  address: string;
  sub: string;
  open: boolean;
}

interface Person {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
}

const CLOSED = new Set(['closed', 'cancelled', 'canceled', 'terminated', 'converted', 'expired', 'withdrawn']);

// "Add to a deal or listing" from the Contacts page: pick where this person goes and what they are
// there (Buyer, Lender, Photographer...). Stays open so one person can go on several files.
export default function AddContactToDealModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const [tab, setTab] = useState<'deals' | 'listings'>('deals');
  const [deals, setDeals] = useState<Target[]>([]);
  const [listings, setListings] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [role, setRole] = useState(person.role || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tRes, lRes] = await Promise.all([authFetch('/api/transactions'), authFetch('/api/listings').catch(() => null)]);
        const t = await tRes.json();
        if (!tRes.ok) throw new Error(t.error || 'Failed to load deals');
        const l = lRes && lRes.ok ? await lRes.json() : [];
        if (!alive) return;
        setDeals(
          (Array.isArray(t) ? t : []).map((x: Record<string, unknown>) => ({
            id: String(x.id),
            address: String(x.property_address || 'Untitled deal'),
            sub: [x.file_number, x.status].filter(Boolean).join(' · '),
            open: !CLOSED.has(String(x.status || '').toLowerCase()),
          }))
        );
        setListings(
          (Array.isArray(l) ? l : []).map((x: Record<string, unknown>) => ({
            id: String(x.id),
            address: String(x.property_address || 'Untitled listing'),
            sub: [x.seller_name, x.status].filter(Boolean).join(' · '),
            open: !CLOSED.has(String(x.status || '').toLowerCase()),
          }))
        );
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const list = tab === 'deals' ? deals : listings;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((t) => (showClosed ? true : t.open))
      .filter((t) => !needle || `${t.address} ${t.sub}`.toLowerCase().includes(needle))
      .slice(0, 100);
  }, [list, q, showClosed]);

  const add = async (t: Target) => {
    const key = `${tab}:${t.id}`;
    setBusy(key);
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      const path = tab === 'deals' ? `/api/transactions/${t.id}/contacts` : `/api/listings/${t.id}/contacts`;
      const res = await authFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: role.trim(), name: person.name || person.company || '', email: person.email || '', phone: person.phone || '' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not add');
      setAdded((prev) => new Set(prev).add(key));
    } catch (err) {
      setRowError((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Could not add' }));
    } finally {
      setBusy(null);
    }
  };

  const tabCls = (on: boolean) => `px-3 py-1.5 text-sm rounded-md ${on ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-slate-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-slate-800 border border-slate-600 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-100">Add to a deal or listing</h2>
            <p className="text-sm text-slate-400 break-words">{person.name || person.company || person.email}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 shrink-0">
            Done
          </button>
        </div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Their role on it</label>
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Buyer, Lender, Photographer…"
          className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-3"
        />
        <div className="flex items-center gap-1 mb-2">
          <button type="button" className={tabCls(tab === 'deals')} onClick={() => setTab('deals')}>
            Deals ({deals.filter((d) => showClosed || d.open).length})
          </button>
          <button type="button" className={tabCls(tab === 'listings')} onClick={() => setTab('listings')}>
            Listings ({listings.filter((d) => showClosed || d.open).length})
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-blue-500" />
            Include closed
          </label>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by address"
          className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-3"
        />
        <div className="overflow-y-auto space-y-2 min-h-[8rem]">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && shown.length === 0 && <p className="text-sm text-slate-400">Nothing to show.</p>}
          {shown.map((t) => {
            const key = `${tab}:${t.id}`;
            return (
              <div key={key} className="rounded-lg bg-slate-700/40 border border-slate-600/60 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100 font-medium break-words">{t.address}</p>
                    {t.sub && <p className="text-xs text-slate-500 break-words">{t.sub}</p>}
                  </div>
                  {added.has(key) ? (
                    <span className="text-xs text-green-400 shrink-0 pt-0.5">Added</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => add(t)}
                      className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 shrink-0"
                    >
                      {busy === key ? 'Adding…' : 'Add'}
                    </button>
                  )}
                </div>
                {rowError[key] && <p className="text-xs text-red-400 mt-1">{rowError[key]}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
