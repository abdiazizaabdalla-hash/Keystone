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
  dates: { label: string; date: string; dateDisplay: string; completed: boolean }[];
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
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-xl mx-auto space-y-6">
          <div className="text-center">
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Transaction progress</p>
            <h1 className="text-2xl font-display font-semibold text-slate-100">{info.propertyAddress}</h1>
            {info.clientName && <p className="text-slate-400 mt-1">Prepared for {info.clientName}</p>}
          </div>

          {info.note && (
            <div className="bg-blue-500/10 border border-blue-400/30 rounded-2xl p-5">
              <p className="text-slate-200 whitespace-pre-wrap text-sm leading-relaxed">{info.note}</p>
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-slate-400 text-sm">Where things stand</span>
              <span className="text-slate-100 font-semibold">{closed ? 'Closed' : info.currentStage}</span>
            </div>
            <div
              className="h-2.5 rounded-full bg-slate-700 overflow-hidden"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Transaction progress"
            >
              <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-slate-500 text-xs mt-2">{percent}% of the way to closing</p>
            {nextDate && (
              <p className="text-slate-300 text-sm mt-4">
                Next up: <span className="font-semibold text-slate-100">{nextDate.label}</span> on {nextDate.dateDisplay}
              </p>
            )}
          </div>

          {info.steps.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-slate-100 font-semibold">Checklist</h2>
                <span className="text-xs text-slate-400">
                  {info.steps.filter((x) => x.completed).length} of {info.steps.length} done
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
                    {!step.completed &&
                      (step.dueDate ? (
                        <span className={`text-xs font-medium flex-shrink-0 ${step.dueDate < today ? 'text-red-400' : 'text-slate-500'}`}>
                          {step.dueDate < today ? 'Overdue ' : 'Due '}
                          {formatDisplayDate(step.dueDate, { month: '2-digit', day: '2-digit' })}
                        </span>
                      ) : null)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <ClientPortalMessages token={token} agentName={info.people.agentName} tcName={info.people.tcName} />

          {info.documents.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-slate-100 font-semibold mb-3">Documents</h2>
              <input
                type="search"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Search documents…"
                aria-label="Search documents"
                className="w-full mb-3 bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="space-y-3">
                {(() => {
                  const q = docSearch.trim().toLowerCase();
                  const visible = info.documents.filter((d) => !q || d.fileName.toLowerCase().includes(q));
                  if (visible.length === 0) return <p className="text-sm text-slate-500 italic">No documents match &quot;{docSearch}&quot;.</p>;
                  const known = new Set(DOCUMENT_CATEGORIES.map((c) => c.key));
                  const groups = [
                    ...DOCUMENT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
                    { key: '__other', label: 'Uncategorized' },
                  ];
                  return groups.map((cat) => {
                    const docs = visible.filter((d) => (known.has(d.category) ? d.category : '__other') === cat.key);
                    if (docs.length === 0) return null;
                    const collapsed = Boolean(collapsedCategories[cat.key]) && !q;
                    return (
                      <div key={cat.key} className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setCollapsedCategories((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                          aria-expanded={!collapsed}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-left"
                        >
                          <span className="text-sm font-semibold text-slate-100">
                            {cat.label} <span className="text-xs font-normal text-slate-500">({docs.length})</span>
                          </span>
                          <span className="text-slate-400 text-xs">{collapsed ? 'Show' : 'Hide'}</span>
                        </button>
                        {!collapsed && (
                          <div className="px-4 pb-3 space-y-2">
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
                  });
                })()}
              </div>
            </div>
          )}

          {info.dates.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-slate-100 font-semibold mb-3">Key dates</h2>
              <div className="space-y-3">
                {info.dates.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 text-sm">
                    <span className={d.completed ? 'text-slate-500 line-through' : 'text-slate-300'}>{d.label}</span>
                    <span className="text-slate-100 font-semibold whitespace-nowrap">{d.dateDisplay}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-center text-slate-600 text-xs">Updated automatically as your coordinator completes each step.</p>
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
