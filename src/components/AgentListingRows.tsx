'use client';

import Link from 'next/link';
import { LISTING_STATUS_LABEL, type ListingStatus } from '@/lib/listingsShared';

// A list of listings that belong to agents in the brokerage, each with its status, progress and next step. Read-only: every row opens the listing's page.

export interface AgentListing {
  id: string;
  property_address: string | null;
  status: string | null;
  list_price: number | string | null;
  planned_list_date: string | null;
  listed_on: string | null;
  expiration_date: string | null;
  mls_number: string | null;
  agent?: { id: string; name: string };
  health: { openTasks: number; overdueTasks: number; nextDue: string | null; flags: string[] };
  nextStep?: { name: string; dueDate: string | null } | null;
  tasksTotal?: number;
  tasksDone?: number;
  openOffers?: number;
}

const FLAG: Record<string, string> = { overdue: 'Overdue steps', expiring_soon: 'Agreement ending soon' };
const STATUS_STYLE: Record<string, string> = {
  preparing: 'bg-amber-900/30 text-amber-300 border-amber-700/50',
  active: 'bg-green-900/30 text-green-300 border-green-700/50',
  under_offer: 'bg-blue-900/30 text-blue-300 border-blue-700/50',
  converted: 'bg-slate-700 text-slate-300 border-slate-600',
  expired: 'bg-red-900/30 text-red-300 border-red-700/50',
  withdrawn: 'bg-slate-700 text-slate-400 border-slate-600',
};
const fmt = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const price = (v: number | string | null) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? `$${n.toLocaleString()}` : null;
};

export default function AgentListingRows({ listings, showAgent = true }: { listings: AgentListing[]; showAgent?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ul className="grid gap-3">
      {listings.map((l) => {
        const open = l.status === 'preparing' || l.status === 'active' || l.status === 'under_offer';
        const total = l.tasksTotal ?? 0;
        const done = l.tasksDone ?? 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const overdue = l.nextStep?.dueDate && l.nextStep.dueDate < today;
        return (
          <li key={l.id}>
            <Link href={`/dashboard/collaborate/listings/${l.id}`} className="block bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-4 transition">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`font-semibold break-words ${open ? 'text-slate-100' : 'text-slate-400'}`}>{l.property_address || 'Untitled listing'}</p>
                  <p className="text-xs text-slate-500">{[showAgent && l.agent?.name && `Agent: ${l.agent.name}`, l.mls_number && `MLS ${l.mls_number}`, price(l.list_price)].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {l.health.flags.map((f) => (
                    <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{FLAG[f] ?? f}</span>
                  ))}
                  {(l.openOffers ?? 0) > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300">{l.openOffers} open offer{l.openOffers === 1 ? '' : 's'}</span>}
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border ${STATUS_STYLE[l.status ?? ''] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>{LISTING_STATUS_LABEL[l.status as ListingStatus] ?? l.status}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                {total > 0 && (
                  <>
                    <span>{done}/{total} steps done</span>
                    <span className="w-28 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden>
                      <span className="block h-full bg-blue-500" style={{ width: `${pct}%` }} />
                    </span>
                  </>
                )}
                {open && !l.listed_on && l.planned_list_date && <span>Planned to list {fmt(l.planned_list_date)}</span>}
                {open && l.listed_on && <span>Listed {fmt(l.listed_on)}</span>}
                {open && l.expiration_date && <span>Agreement ends {fmt(l.expiration_date)}</span>}
                {open && (l.nextStep ? (
                  <span className={overdue ? 'text-amber-300' : 'text-slate-300'}>Next: {l.nextStep.name}{l.nextStep.dueDate ? ` · ${overdue ? 'was due' : 'due'} ${fmt(l.nextStep.dueDate)}` : ''}</span>
                ) : (
                  <span>No open steps</span>
                ))}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
