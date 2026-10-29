'use client';

import { use, useEffect, useState } from 'react';
import ClientPortalMessages from '@/components/ClientPortalMessages';
import { DOCUMENT_CATEGORIES } from '@/lib/documentTaxonomy';
import { formatDisplayDate } from '@/lib/dueDates';

interface DatesInfo {
  scope: 'dates';
  propertyAddress: string;
  fileNumber: string;
  acceptanceDate: string | null;
  closingDate: string | null;
  dates: { label: string; date: string; dateDisplay: string }[];
}

interface DocumentInfo {
  scope: 'document';
  propertyAddress: string;
  fileNumber: string;
  fileName: string;
  contentType: string | null;
  previewUrl: string | null;
}

interface ProgressInfo {
  scope: 'progress';
  propertyAddress: string;
  clientName: string | null;
  note: string | null;
  stages: string[];
  stageIndex: number;
  currentStage: string;
  steps: { name: string; completed: boolean; dueDate: string | null }[];
  dates: { label: string; kind: string; help: string | null; date: string; dateDisplay: string; completed: boolean }[];
  documents: { id: string; fileName: string; fileSize: number | null; category: string; documentType: string | null }[];
  people: { agentName: string | null; tcName: string | null };
}

type ExternalInfo = DatesInfo | DocumentInfo | ProgressInfo;

// Public, unauthenticated page -- the token in the URL is the only
// credential (see lib/externalAccess.ts). No dashboard chrome: whoever
// opens this link (a lender, a title company, an inspector) has no
// Relay TC account, and the response already carries only what this
// link's scope allows -- nothing extra to hide here either.
export default function ExternalAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<ExternalInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`/api/external/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This link is invalid or has expired');
        setInfo(data);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-10 h-10 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center bg-slate-800/50 border border-slate-600 rounded-lg p-8">
          <h1 className="text-xl font-bold text-slate-100 mb-2">Link unavailable</h1>
          <p className="text-slate-400 text-sm">{loadError || 'This link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  if (info.scope === 'document') {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6 text-center">
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">
              {info.fileNumber} · {info.propertyAddress}
            </p>
            <h1 className="text-2xl font-display font-semibold text-slate-100">{info.fileName}</h1>
          </div>

          {info.previewUrl ? (
            <div className="bg-slate-800/50 border border-slate-600 rounded-lg overflow-hidden" style={{ height: '70vh' }}>
              <iframe src={info.previewUrl} title={info.fileName} className="w-full h-full" />
            </div>
          ) : (
            <p className="text-center text-slate-400">This document is no longer available.</p>
          )}

          {info.previewUrl && (
            <div className="mt-6 text-center">
              <a
                href={info.previewUrl}
                className="inline-block px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition"
              >
                Download
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (info.scope === 'progress') {
    const lastIndex = Math.max(1, info.stages.length - 1);
    const percent = Math.round((info.stageIndex / lastIndex) * 100);
    const closed = info.stageIndex >= info.stages.length - 1;
    const today = new Date().toISOString().slice(0, 10);
    const nextDate = info.dates.find((d) => !d.completed && d.date >= today);
    const doneCount = info.steps.filter((x) => x.completed).length;
    // Each date becomes a timeline entry: what it is, when (with weekday),
    // and a plain status -- done, today, N days away, or N days overdue.
    const startOfToday = new Date(`${today}T00:00:00`).getTime();
    const firstOpen = info.dates.findIndex((d) => !(d.completed || (d.kind === 'closing' && closed)) && d.date >= today);
    const timeline = info.dates.map((d, i) => {
      const done = d.completed || (d.kind === 'closing' && closed);
      const days = Math.round((new Date(`${d.date}T00:00:00`).getTime() - startOfToday) / 86400000);
      const when = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      let status: string;
      let tone: string;
      let dot: string;
      let mark: string;
      if (done) {
        status = 'Done';
        tone = 'text-emerald-400';
        dot = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50';
        mark = '✓';
      } else if (days < 0) {
        status = `${-days} day${days === -1 ? '' : 's'} overdue`;
        tone = 'text-red-400';
        dot = 'bg-red-500/20 text-red-300 border border-red-500/50';
        mark = '!';
      } else if (days === 0) {
        status = 'Today';
        tone = 'text-amber-300';
        dot = 'bg-amber-500/20 text-amber-300 border border-amber-500/50';
        mark = '•';
      } else {
        status = days === 1 ? 'Tomorrow' : `In ${days} days`;
        tone = i === firstOpen ? 'text-blue-300' : 'text-slate-400';
        dot = i === firstOpen ? 'bg-blue-500/30 text-blue-200 border border-blue-400' : 'bg-slate-700 text-slate-400 border border-slate-600';
        mark = '•';
      }
      return { label: d.label, help: d.help, when, status, tone, dot, mark, done, isNext: i === firstOpen };
    });
    const q = docSearch.trim().toLowerCase();
    const visibleDocs = info.documents.filter((d) => !q || d.fileName.toLowerCase().includes(q));
    const knownCategories = new Set(DOCUMENT_CATEGORIES.map((c) => c.key));
    const docGroups = [
      ...DOCUMENT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
      { key: '__other', label: 'Uncategorized' },
    ];

    // Same arrangement as the agent portal: a deal card on top, then
    // Documents wide on the left with Messages and the Checklist stacked in
    // a narrow column on the right (stacked, right column first, on a phone).
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 mb-8">
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Transaction progress</p>
            <h1 className="text-xl font-display font-semibold text-slate-100">{info.propertyAddress}</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {info.clientName ? `Prepared for ${info.clientName}` : 'Your transaction'}
              {info.people.tcName ? ` · Coordinated by ${info.people.tcName}` : ''}
            </p>

            {/* Who is who: the agent and the coordinator do different jobs. */}
            <div className="pt-6 mt-6 border-t border-slate-600">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Your team</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    role: 'Your agent',
                    name: info.people.agentName || 'Your agent',
                    blurb: 'Your main contact and advocate. Ask about offers, negotiations and what to expect next.',
                    tone: 'from-blue-500 to-blue-600',
                  },
                  {
                    role: 'Transaction coordinator',
                    name: info.people.tcName || 'Your coordinator',
                    blurb: 'Keeps the paperwork, deadlines and checklist on track. Ask where a document or step stands.',
                    tone: 'from-emerald-500 to-emerald-600',
                  },
                ].map((person) => (
                  <div key={person.role} className="flex items-start gap-3 bg-slate-700/30 border border-slate-600 rounded-xl p-4">
                    <div
                      className={`w-10 h-10 bg-gradient-to-br ${person.tone} rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0`}
                      aria-hidden="true"
                    >
                      {person.name[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{person.role}</p>
                      <p className="text-base font-semibold text-slate-100 truncate">{person.name}</p>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{person.blurb}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 mt-6 border-t border-slate-600">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Where things stand</p>
                <p className="text-lg font-semibold text-blue-400">{closed ? 'Closed' : info.currentStage}</p>
                {nextDate && (
                  <p className="text-xs text-slate-400 mt-1">
                    Next up: <span className="text-slate-200 font-medium">{nextDate.label}</span> on {nextDate.dateDisplay}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Progress</p>
                <div
                  className="w-full h-2 bg-slate-600 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Transaction progress"
                >
                  <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${percent}%` }} />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">{percent}% of the way to closing</p>
              </div>
            </div>

            {info.note && (
              <div className="mt-6 bg-blue-500/10 border border-blue-400/30 rounded-xl p-4">
                <p className="text-slate-200 whitespace-pre-wrap text-sm leading-relaxed">{info.note}</p>
              </div>
            )}

            {info.dates.length > 0 && (
              <div className="pt-6 mt-6 border-t border-slate-600">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Important dates</p>
                <p className="text-xs text-slate-500 mb-4">The deadlines that keep your transaction on track, in order.</p>
                <ol className="space-y-0">
                  {timeline.map((d, i) => (
                    <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                      {i < timeline.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-600" aria-hidden="true" />}
                      <span
                        className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${d.dot}`}
                        aria-hidden="true"
                      >
                        {d.mark}
                      </span>
                      <div
                        className={`flex-1 min-w-0 rounded-xl border px-4 py-3 ${
                          d.isNext ? 'border-blue-400/60 bg-blue-500/10' : 'border-slate-600 bg-slate-700/20'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <p className={`text-sm font-semibold ${d.done ? 'text-slate-400' : 'text-slate-100'}`}>
                            {d.label}
                            {d.isNext && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-blue-300">Next up</span>}
                          </p>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${d.done ? 'text-slate-500' : 'text-slate-100'}`}>{d.when}</p>
                            <p className={`text-xs font-medium ${d.tone}`}>{d.status}</p>
                          </div>
                        </div>
                        {d.help && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{d.help}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
            <div className="lg:order-2 lg:self-start flex flex-col gap-8 min-w-0">
              <ClientPortalMessages token={token} agentName={info.people.agentName} tcName={info.people.tcName} />

              {info.steps.length > 0 && (
                <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-slate-100 mb-1">Checklist</h2>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">{doneCount}</span> of{' '}
                      <span className="font-semibold text-slate-300">{info.steps.length}</span> completed
                    </span>
                    <span className="text-xs font-semibold text-blue-400">
                      {Math.round((doneCount / info.steps.length) * 100)}%
                    </span>
                  </div>
                  <div className="space-y-2">
                    {info.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg">
                        <input
                          type="checkbox"
                          checked={step.completed}
                          readOnly
                          tabIndex={-1}
                          aria-label={`${step.name}: ${step.completed ? 'done' : 'still to do'}`}
                          className="w-4 h-4 rounded border-2 border-slate-600 accent-blue-500 pointer-events-none flex-shrink-0"
                        />
                        <span className={`flex-1 text-sm font-medium ${step.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                          {step.name}
                        </span>
                        {!step.completed && step.dueDate && (
                          <span className={`text-xs font-medium flex-shrink-0 ${step.dueDate < today ? 'text-red-400' : 'text-slate-500'}`}>
                            {step.dueDate < today ? 'Overdue ' : 'Due '}
                            {formatDisplayDate(step.dueDate, { month: '2-digit', day: '2-digit' })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-slate-500 text-xs mt-4">View-only. Your team updates this as each step is completed.</p>
                </section>
              )}
            </div>

            <section className="lg:order-1 bg-white/5 border border-white/10 rounded-2xl p-8 min-w-0">
              <h2 className="text-2xl font-bold text-slate-100 mb-2">Documents</h2>
              {info.documents.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Your agent has not shared any documents yet. They will appear here when they do.</p>
              ) : (
                <>
                  <p className="text-sm text-slate-400 mb-4">Documents your agent has shared with you.</p>
                  <input
                    type="search"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    placeholder="Search documents…"
                    aria-label="Search documents"
                    className="w-full mb-4 bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  <div className="space-y-3">
                    {visibleDocs.length === 0 && <p className="text-sm text-slate-500 italic">No documents match &quot;{docSearch}&quot;.</p>}
                    {docGroups.map((cat) => {
                      const docs = visibleDocs.filter((d) => (knownCategories.has(d.category) ? d.category : '__other') === cat.key);
                      if (docs.length === 0) return null;
                      const collapsed = Boolean(collapsedCategories[cat.key]) && !q;
                      return (
                        <div key={cat.key} className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setCollapsedCategories((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                            aria-expanded={!collapsed}
                            className="w-full flex items-center justify-between px-4 py-3 text-left"
                          >
                            <span className="text-sm font-semibold text-slate-100">
                              {cat.label} <span className="text-xs font-normal text-slate-500">({docs.length})</span>
                            </span>
                            <span className="text-slate-400 text-xs">{collapsed ? 'Show' : 'Hide'}</span>
                          </button>
                          {!collapsed && (
                            <div className="px-4 pb-4 space-y-2">
                              {docs.map((doc) => (
                                <a
                                  key={doc.id}
                                  href={`/api/external/${token}/documents/${doc.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/50 border border-slate-600 px-4 py-2.5 text-sm hover:border-blue-400 transition"
                                >
                                  <span className="min-w-0">
                                    <span className="block text-blue-300 truncate">📄 {doc.fileName}</span>
                                    {doc.documentType && <span className="block text-xs text-slate-500">{doc.documentType}</span>}
                                  </span>
                                  {doc.fileSize ? (
                                    <span className="text-xs text-slate-500 flex-shrink-0">{(doc.fileSize / 1024).toFixed(0)} KB</span>
                                  ) : null}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          </div>

          <p className="text-center text-slate-600 text-xs mt-10">Updated automatically as your team completes each step.</p>
        </div>
      </div>
    );
  }

  // scope === 'dates'
  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-xl mx-auto">
        <div className="mb-8 text-center">
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">{info.fileNumber}</p>
          <h1 className="text-2xl font-display font-semibold text-slate-100">{info.propertyAddress}</h1>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
          {info.acceptanceDate && (
            <div className="flex items-center justify-between border-b border-slate-600/50 pb-3">
              <span className="text-slate-300">Acceptance Date</span>
              <span className="text-slate-100 font-semibold">{info.acceptanceDate}</span>
            </div>
          )}
          {info.closingDate && (
            <div className="flex items-center justify-between border-b border-slate-600/50 pb-3">
              <span className="text-slate-300">Target Closing Date</span>
              <span className="text-slate-100 font-semibold">{info.closingDate}</span>
            </div>
          )}
          {info.dates.length === 0 && !info.acceptanceDate && !info.closingDate && (
            <p className="text-slate-400 text-center">No dates have been set on this transaction yet.</p>
          )}
          {info.dates.map((d, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-slate-300">{d.label}</span>
              <span className="text-slate-100 font-semibold">{d.dateDisplay}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
