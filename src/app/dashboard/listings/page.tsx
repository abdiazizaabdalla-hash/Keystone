'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import { LISTING_STATUS_LABEL, type ListingStatus } from '@/lib/listingsShared';

interface ListingRow {
  id: string;
  property_address: string;
  seller_name: string | null;
  list_price: number | null;
  planned_list_date: string | null;
  status: ListingStatus;
  agent_name: string | null;
  tasks_total: number;
  tasks_done: number;
  overdue_count: number;
  next_due_date: string | null;
  open_offers: number;
}
interface AgentOption {
  id: string;
  name: string;
}

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

const STATUS_STYLE: Record<ListingStatus, string> = {
  preparing: 'bg-amber-900/30 text-amber-300 border-amber-700/50',
  active: 'bg-green-900/30 text-green-300 border-green-700/50',
  under_offer: 'bg-blue-900/30 text-blue-300 border-blue-700/50',
  converted: 'bg-slate-700 text-slate-300 border-slate-600',
  expired: 'bg-red-900/30 text-red-300 border-red-700/50',
  withdrawn: 'bg-slate-700 text-slate-400 border-slate-600',
};

const money = (n: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '—');

export default function ListingsPage() {
  const router = useRouter();
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    propertyAddress: '',
    agentId: '',
    sellerName: '',
    sellerEmail: '',
    sellerPhone: '',
    listPrice: '',
    plannedListDate: '',
  });

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
      const [lRes, aRes] = await Promise.all([authFetch('/api/listings'), authFetch('/api/agents')]);
      const l = await lRes.json();
      const a = await aRes.json();
      if (!lRes.ok) throw new Error(l.error || 'Failed to load listings');
      setListings(l);
      if (Array.isArray(a)) setAgents(a.map((x: AgentOption) => ({ id: x.id, name: x.name })));
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const visible = useMemo(
    () => (filter === 'all' ? listings : listings.filter((l) => l.status === 'preparing' || l.status === 'active' || l.status === 'under_offer')),
    [listings, filter]
  );

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const res = await authFetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, agentId: form.agentId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create listing');
      router.push(`/dashboard/listings/${data.id}`);
    } catch (err) {
      if (handleAuth(err)) return;
      setFormError(err instanceof Error ? err.message : 'Failed to create listing');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading listings…</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Listings</h1>
          <p className="text-slate-400">Everything before the contract: prep, go-live, showings and offers. An accepted offer becomes a deal.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/listings/template" className="text-sm text-slate-400 hover:text-slate-200">
            Edit default checklist
          </Link>
          <button
            type="button"
            onClick={() => {
              setFormError('');
              setShowNew(true);
            }}
            className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition"
          >
            + New listing
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="mb-4 flex items-center gap-2 text-sm">
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border ${filter === f ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
          >
            {f === 'open' ? 'Open listings' : 'All'}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8 text-center">
          <p className="text-slate-300 mb-1">{listings.length === 0 ? 'No listings yet.' : 'No open listings.'}</p>
          <p className="text-sm text-slate-500">Start one when a listing agreement is signed. Relay adds the prep checklist and counts the days to your list date.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((l) => {
            const pct = l.tasks_total ? Math.round((l.tasks_done / l.tasks_total) * 100) : 0;
            return (
              <Link
                key={l.id}
                href={`/dashboard/listings/${l.id}`}
                className="block bg-slate-800/50 border border-slate-700 hover:border-slate-500 rounded-lg p-4 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-slate-100 font-semibold break-words">{l.property_address}</p>
                    <p className="text-xs text-slate-500">
                      {[l.seller_name && `Seller: ${l.seller_name}`, l.agent_name && `Agent: ${l.agent_name}`, money(l.list_price)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border ${STATUS_STYLE[l.status] || STATUS_STYLE.preparing}`}>{LISTING_STATUS_LABEL[l.status] || l.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                  <span>
                    {l.tasks_done}/{l.tasks_total} steps done
                  </span>
                  <span className="w-28 h-1.5 rounded-full bg-slate-700 overflow-hidden" aria-hidden>
                    <span className="block h-full bg-blue-500" style={{ width: `${pct}%` }} />
                  </span>
                  {l.planned_list_date && <span>List date {formatDisplayDate(l.planned_list_date)}</span>}
                  {l.overdue_count > 0 && <span className="text-red-300">{l.overdue_count} overdue</span>}
                  {l.open_offers > 0 && (
                    <span className="text-blue-300">
                      {l.open_offers} open offer{l.open_offers === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <form onSubmit={create} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-slate-100">New listing</h2>
            <input className={inputCls} placeholder="Property address *" value={form.propertyAddress} onChange={(e) => setForm({ ...form, propertyAddress: e.target.value })} required autoFocus />
            <select className={inputCls} value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
              <option value="">Listing agent (choose one)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={inputCls} placeholder="Seller name" value={form.sellerName} onChange={(e) => setForm({ ...form, sellerName: e.target.value })} />
              <input className={inputCls} placeholder="Seller email" type="email" value={form.sellerEmail} onChange={(e) => setForm({ ...form, sellerEmail: e.target.value })} />
              <input className={inputCls} placeholder="Seller phone" value={form.sellerPhone} onChange={(e) => setForm({ ...form, sellerPhone: e.target.value })} />
              <input className={inputCls} placeholder="List price" inputMode="decimal" value={form.listPrice} onChange={(e) => setForm({ ...form, listPrice: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Planned list date</label>
              <input className={inputCls} type="date" value={form.plannedListDate} onChange={(e) => setForm({ ...form, plannedListDate: e.target.value })} />
              <p className="text-xs text-slate-500 mt-1">Checklist due dates count back and forward from this day, and move if you change it.</p>
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={saving} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {saving ? 'Creating…' : 'Create listing'}
              </button>
              <button type="button" onClick={() => setShowNew(false)} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
