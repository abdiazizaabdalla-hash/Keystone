'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { LISTING_STATUS_LABEL, type ListingStatus } from '@/lib/listingsShared';

// A brokerage owner's page for one listing of an agent in their brokerage. Read-only: the listing, its checklist and the
// names of its documents. Seller details and offers stay in the agent's workspace.

interface Detail {
  listing: { id: string; property_address: string | null; status: string | null; list_price: number | string | null; planned_list_date: string | null; listed_on: string | null; expiration_date: string | null; mls_number: string | null };
  agent: { name: string; email: string | null } | null;
  tasks: { id: string; name: string; completed: boolean | null; due_date: string | null }[];
  documents: { id: string; file_name: string; document_type: string | null }[];
  offers: { total: number; open: number };
  health: { openTasks: number; overdueTasks: number; nextDue: string | null; flags: string[] };
}

const fmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set');
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function OversightListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/oversight/listings/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load this listing');
        setDetail(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load this listing');
      }
    }, 0);
    return () => clearTimeout(t);
  }, [id]);

  const back = <Link href="/dashboard/listings" className="text-sm text-blue-400 hover:text-blue-300">← Back to listings</Link>;
  if (!detail) {
    return (
      <div className="p-4 md:p-8 max-w-4xl">
        {back}
        <p className="text-slate-400 text-sm mt-4">{error || 'Loading…'}</p>
      </div>
    );
  }

  const { listing, agent, tasks, documents, offers, health } = detail;
  const done = tasks.filter((t) => t.completed).length;
  const today = new Date().toISOString().slice(0, 10);
  const price = Number(listing.list_price);
  const facts: [string, string][] = [
    ['Status', LISTING_STATUS_LABEL[listing.status as ListingStatus] ?? listing.status ?? '—'],
    ['List price', Number.isFinite(price) && price > 0 ? `$${price.toLocaleString()}` : 'Not set'],
    ['Planned to list', fmt(listing.planned_list_date)],
    ['Listed on', fmt(listing.listed_on)],
    ['Agreement ends', fmt(listing.expiration_date)],
    ['MLS number', listing.mls_number || 'Not set'],
    ['Offers', offers.total === 0 ? 'None yet' : `${offers.total} received${offers.open ? `, ${offers.open} open` : ''}`],
  ];

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-5">
      {back}
      <div>
        <h1 className="text-2xl font-display font-semibold text-slate-100">{listing.property_address || 'Listing'}</h1>
        <p className="text-slate-400 text-sm">{agent?.name ?? 'Agent'}{agent?.email ? ` · ${agent.email}` : ''}</p>
      </div>
      {health.flags.length > 0 && (
        <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Needs attention:{' '}
          {health.flags.map((f) => ({ overdue: `${health.overdueTasks} overdue step${health.overdueTasks === 1 ? '' : 's'}`, expiring_soon: 'the listing agreement ends within 14 days' } as Record<string, string>)[f] ?? f).join(', ')}.
        </p>
      )}

      <div className={`${card} grid sm:grid-cols-3 gap-4`}>
        {facts.map(([k, v]) => (
          <div key={k}>
            <p className="text-xs text-slate-400">{k}</p>
            <p className="text-sm text-slate-100">{v}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Checklist</h2>
        <p className="text-xs text-slate-400 mb-3">{done} of {tasks.length} done{health.nextDue ? ` · next due ${fmt(health.nextDue)}` : ''}</p>
        <ul className="divide-y divide-white/5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span aria-hidden className={`h-4 w-4 rounded border ${t.completed ? 'bg-emerald-500/70 border-emerald-400' : 'border-slate-500'}`} />
              <span className={`flex-1 text-sm ${t.completed ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{t.name}</span>
              {t.due_date && <span className={`text-xs ${!t.completed && t.due_date.slice(0, 10) < today ? 'text-amber-300' : 'text-slate-400'}`}>{fmt(t.due_date)}</span>}
            </li>
          ))}
          {tasks.length === 0 && <li className="text-sm text-slate-400 py-2">No checklist on this listing.</li>}
        </ul>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Documents</h2>
        <p className="text-xs text-slate-400 mb-3">Names only. The files themselves stay in the agent’s workspace.</p>
        {documents.length === 0 ? <p className="text-sm text-slate-400">None yet.</p> : (
          <ul className="text-sm text-slate-200 space-y-1">
            {documents.map((d) => (
              <li key={d.id}>{d.file_name}{d.document_type && d.document_type !== 'General' ? <span className="text-xs text-slate-500"> · {d.document_type}</span> : null}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
