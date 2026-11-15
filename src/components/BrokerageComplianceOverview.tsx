'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import ComplianceReportMenu from '@/components/ComplianceReportMenu';

// The broker's compliance desk in one look: what needs a decision today, with a way into each list.
interface FileRow { id: string; address: string | null; agentName: string; missing: string[]; review: { status: 'reviewed' | 'flagged' } | null }
interface ReviewData { files: FileRow[]; totals: { needsReview: number; flagged: number; reviewed: number } }

export default function BrokerageComplianceOverview({ goTo, showCommissions }: { goTo: (tab: 'files' | 'requirements') => void; showCommissions: boolean }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [late, setLate] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    authFetch('/api/oversight/file-review')
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'Could not load compliance'); if (live) setData(b); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load compliance'); });
    authFetch('/api/oversight/reports/trends?months=6&period=3')
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (r.ok && live) setLate(b.pipeline?.withOverdueSteps ?? 0); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  if (!data) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;
  const missing = data.files.filter((f) => f.missing.length > 0);
  const tiles = [
    { label: 'Files to review', value: data.totals.needsReview, tone: data.totals.needsReview > 0 ? 'text-amber-300' : '', tab: 'files' as const },
    { label: 'Flagged for the agent', value: data.totals.flagged, tone: data.totals.flagged > 0 ? 'text-red-300' : '', tab: 'files' as const },
    { label: 'Missing documents', value: missing.length, tone: missing.length > 0 ? 'text-amber-300' : '', tab: 'files' as const },
    { label: 'Open deals with late steps', value: late ?? '—', tone: (late ?? 0) > 0 ? 'text-amber-300' : '', tab: null },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => {
          const body = (
            <>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">{t.label}</p>
              <p className={`text-3xl font-semibold mt-1 ${t.tone || 'text-slate-100'}`}>{t.value}</p>
            </>
          );
          const cls = 'bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-left';
          return t.tab ? (
            <button key={t.label} type="button" onClick={() => goTo(t.tab)} className={`${cls} hover:bg-white/10 transition`}>{body}</button>
          ) : (
            <Link key={t.label} href="/dashboard/transactions" className={`${cls} hover:bg-white/10 transition block`}>{body}</Link>
          );
        })}
      </div>

      {missing.length > 0 && (
        <section className="bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
            <h2 className="text-sm font-semibold text-slate-100">Files missing documents</h2>
            <button type="button" onClick={() => goTo('files')} className="text-xs text-blue-400 hover:text-blue-300">Open file review →</button>
          </div>
          <ul className="divide-y divide-white/5">
            {missing.slice(0, 6).map((f) => (
              <li key={f.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/dashboard/collaborate/deals/${f.id}`} className="text-sm text-slate-100 hover:text-blue-300">{f.address ?? 'Untitled deal'}</Link>
                  <p className="text-xs text-slate-500">{f.agentName}</p>
                </div>
                <p className="text-xs text-amber-300">{f.missing.length} missing: {f.missing.slice(0, 2).join(', ')}{f.missing.length > 2 ? '…' : ''}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-100">Required documents</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">What every file must hold, by deal type.</p>
          <button type="button" onClick={() => goTo('requirements')} className="text-sm text-blue-400 hover:text-blue-300">Edit the lists →</button>
        </div>
        {showCommissions && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <p className="text-sm font-semibold text-slate-100">Commissions</p>
            <p className="text-xs text-slate-400 mt-1 mb-3">Splits, what each agent is owed, and statements.</p>
            <Link href="/dashboard/invoices" className="text-sm text-blue-400 hover:text-blue-300">Open commissions →</Link>
          </div>
        )}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-100">Compliance report</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">Every agent and the stage of each file, to print or file.</p>
          <ComplianceReportMenu />
        </div>
      </div>
    </div>
  );
}
