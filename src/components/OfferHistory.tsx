'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { OFFER_DOC_KIND_LABEL, TERM_FIELDS, VERSION_KIND_LABEL, diffTerms, formatTerm, normalizeTerms, type OfferDocKind, type VersionKind } from '@/lib/offerTerms';

interface Version {
  id: string;
  version_number: number;
  kind: VersionKind;
  label: string | null;
  terms: Record<string, unknown>;
  summary: string | null;
  created_by_label: string | null;
  created_at: string;
}
interface Doc {
  id: string;
  version_id: string | null;
  file_name: string;
  doc_kind: OfferDocKind;
  received_at: string;
  url: string | null;
}

const stamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// Every version of one offer, newest first: what changed from the version before, the documents that came with
// it and when they arrived. Earlier terms are never overwritten, so this is the full trail.
export default function OfferHistory({ listingId, offerId, refreshKey }: { listingId: string; offerId: string; refreshKey: number }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch(`/api/listings/${listingId}/offers/${offerId}/versions`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load the history');
        if (!alive) return;
        setVersions(data.versions || []);
        setDocs(data.documents || []);
        setError('');
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load the history');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [listingId, offerId, refreshKey]);

  if (loading) return <p className="text-xs text-slate-500 mt-2">Loading history…</p>;
  if (error) return <p className="text-xs text-red-400 mt-2">{error}</p>;
  if (versions.length === 0 && docs.length === 0) return <p className="text-xs text-slate-500 mt-2">No history yet. Counteroffers and amendments you record will show up here.</p>;

  const ordered = [...versions].reverse();
  const unattached = docs.filter((d) => !d.version_id);

  return (
    <div className="mt-3 border-t border-slate-700 pt-3 space-y-3">
      {ordered.map((v) => {
        const prev = versions.find((x) => x.version_number === v.version_number - 1);
        const changes = prev ? diffTerms(normalizeTerms(prev.terms), normalizeTerms(v.terms)) : [];
        const vDocs = docs.filter((d) => d.version_id === v.id);
        const isCurrent = v.version_number === versions[versions.length - 1].version_number;
        return (
          <div key={v.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-slate-100 font-medium">
                v{v.version_number} · {v.label || VERSION_KIND_LABEL[v.kind] || 'Version'}
              </span>
              {isCurrent && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">Current</span>}
              <span className="text-xs text-slate-500">
                {stamp(v.created_at)}
                {v.created_by_label ? ` · ${v.created_by_label}` : ''}
              </span>
            </div>
            {v.summary && <p className="text-xs text-slate-400 mt-0.5">{v.summary}</p>}
            {changes.length > 0 && (
              <ul className="mt-1 text-xs text-slate-300 space-y-0.5">
                {changes.map((c) => (
                  <li key={c.key}>
                    {c.label}: <span className="text-slate-500 line-through">{c.from}</span> → <span className="text-amber-200">{c.to}</span>
                  </li>
                ))}
              </ul>
            )}
            {vDocs.length > 0 && (
              <ul className="mt-1 text-xs space-y-0.5">
                {vDocs.map((d) => (
                  <li key={d.id}>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 break-all">
                        {d.file_name}
                      </a>
                    ) : (
                      <span className="text-slate-300 break-all">{d.file_name}</span>
                    )}
                    <span className="text-slate-500">
                      {' '}
                      · {OFFER_DOC_KIND_LABEL[d.doc_kind] || 'Document'} · received {stamp(d.received_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} className="mt-1 text-xs text-slate-500 hover:text-slate-300">
              {open === v.id ? 'Hide all terms' : 'Show all terms at this version'}
            </button>
            {open === v.id && (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {TERM_FIELDS.map((f) => {
                  const val = normalizeTerms(v.terms)[f.key];
                  return (
                    <div key={f.key} className="contents">
                      <dt className="text-slate-500">{f.label}</dt>
                      <dd className="text-slate-300 break-words">{formatTerm(f.key, val)}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </div>
        );
      })}
      {unattached.length > 0 && (
        <div className="text-xs">
          <p className="text-slate-500 mb-0.5">Other documents</p>
          {unattached.map((d) => (
            <p key={d.id}>
              {d.url ? (
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 break-all">
                  {d.file_name}
                </a>
              ) : (
                d.file_name
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
