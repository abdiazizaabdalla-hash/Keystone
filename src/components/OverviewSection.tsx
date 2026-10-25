'use client';

import type { ReactNode } from 'react';

// A collapsible summary row used on the Overview tab of the transaction pages.
// Native <details>, so the content stays mounted (and keeps its state) when closed.
export default function OverviewSection({
  title,
  summary,
  tone = 'default',
  action,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  tone?: 'default' | 'danger';
  action?: { label: string; onClick: () => void };
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className={`group rounded-2xl border ${
        tone === 'danger' ? 'bg-red-950/20 border-red-900/50' : 'bg-white/5 border-white/10'
      }`}
    >
      <summary className="flex items-center gap-4 px-5 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className={`font-semibold ${tone === 'danger' ? 'text-red-300' : 'text-slate-100'}`}>{title}</span>
        {summary ? <span className="text-sm text-slate-400 truncate min-w-0">{summary}</span> : null}
        <svg className="w-4 h-4 ml-auto shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-5 pb-5">
        {children}
        {action && (
          <button type="button" onClick={action.onClick} className="mt-4 text-sm font-medium text-blue-400 hover:text-blue-300 transition">
            {action.label} →
          </button>
        )}
      </div>
    </details>
  );
}
