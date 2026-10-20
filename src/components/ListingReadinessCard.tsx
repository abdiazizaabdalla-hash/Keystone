'use client';

import { useState } from 'react';
import { buildListingSummary, computeReadiness } from '@/lib/listingReadiness';
import type { ListingStatus } from '@/lib/listingsShared';

interface Props {
  listing: {
    agent_id: string | null;
    property_address: string;
    status: ListingStatus;
    seller_name: string | null;
    seller_email: string | null;
    seller_phone: string | null;
    list_price: number | null;
    planned_list_date: string | null;
    expiration_date: string | null;
    mls_number: string | null;
    mls_url: string | null;
    notes: string | null;
    docs_not_needed?: string[] | null;
  };
  agentName: string | null;
  docs: { document_type: string; file_name: string }[];
  tasks: { completed: boolean; due_date: string | null }[];
  dates: { label: string; due_date: string }[];
  /** Saves the full list of required documents marked "not needed". */
  onWaive: (docsNotNeeded: string[]) => void;
}

// "What is still missing before this listing goes live?" at a glance, plus a copyable property sheet.
export default function ListingReadinessCard({ listing, agentName, docs, tasks, dates, onWaive }: Props) {
  const { items, doneCount, total, missingDocs } = computeReadiness({ listing, docs, tasks });
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const ready = doneCount === total;
  const waived = listing.docs_not_needed || [];

  const copySummary = async () => {
    const text = buildListingSummary({ listing, agentName, docs, dates, missingDocs });
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-bold text-slate-100">Ready to list</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${ready ? 'bg-green-500/15 text-green-300 border-green-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
          {ready ? 'Ready' : `${doneCount} of ${total} done`}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">What is still missing before this listing can go live, worked out from what is on the listing.</p>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 ${item.done ? 'text-green-400' : 'text-amber-400'}`} aria-hidden="true">
              {item.done ? '✓' : '○'}
            </span>
            <div className="min-w-0 flex-1">
              <p className={item.done ? 'text-slate-300' : 'text-slate-100'}>{item.label}</p>
              <p className="text-xs text-slate-500">{item.detail}</p>
            </div>
            {item.docType && (item.waived || !item.done) && (
              <button
                type="button"
                onClick={() => onWaive(item.waived ? waived.filter((t) => t !== item.docType) : [...waived, item.docType as string])}
                className="shrink-0 text-xs text-slate-400 hover:text-slate-200"
              >
                {item.waived ? 'Needed after all' : 'Not needed'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={copySummary} className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
          Copy listing summary
        </button>
        {copied === 'ok' && <span className="text-xs text-green-300">Copied. Paste it into the MLS entry or an email.</span>}
        {copied === 'fail' && <span className="text-xs text-amber-300">Could not copy automatically.</span>}
      </div>
    </div>
  );
}
