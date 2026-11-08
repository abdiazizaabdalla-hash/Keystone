import type { ReactNode } from 'react';

// An always-open card for the Overview tab, styled like the cards on a deal's Overview: a heading, a one-line summary,
// an "Open ... →" link to the full tab, then the content. (OverviewSection is the collapsible version.)
export default function OverviewCard({
  title,
  summary,
  action,
  children,
}: {
  title: string;
  summary?: ReactNode;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        {action && (
          <button type="button" onClick={action.onClick} className="shrink-0 text-sm text-blue-400 hover:text-blue-300 font-medium transition">
            {action.label} →
          </button>
        )}
      </div>
      {summary ? <p className="text-xs text-slate-500 mb-4 truncate">{summary}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}
