'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { uploadIncoming, type UploadedFile } from '@/lib/incomingUploadClient';
import { FINANCING_TYPES } from '@/lib/listingsShared';
import {
  EMPTY_TERMS,
  OFFER_DOC_KINDS,
  OFFER_DOC_KIND_LABEL,
  TERM_FIELDS,
  VERSION_KIND_LABEL,
  diffTerms,
  formatTerm,
  normalizeTerms,
  rowToTerms,
  type OfferDocKind,
  type OfferTerms,
  type TermKey,
  type VersionKind,
} from '@/lib/offerTerms';

// Add an offer from its documents (or a counteroffer / amendment to one already on file):
//   1. pick the PDFs   2. Relay reads them   3. you check the terms next to the source   4. save.
// Nothing is saved until step 4. Old terms are never overwritten: a change becomes a new version.

interface AiResult {
  final: OfferTerms;
  original: OfferTerms | null;
  documents: { index: number; kind: string; description: string }[];
  changesSummary: string;
  revisionKind: string;
  references: Record<string, { document: number; page: number }>;
  uncertain: Record<string, string>;
  notes: string;
}

interface Props {
  listingId: string;
  /** An offer already on file: the documents are a counteroffer, amendment or revised offer for it. */
  offer?: Record<string, unknown> | null;
  /** Files from an offer email held for review: already in storage, opened here instead of picked. */
  initial?: { inboundId: string; files: { name: string; path: string; url: string | null }[] };
  onClose: () => void;
  onSaved: (message: string) => void;
}

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
const today = () => new Date().toISOString().slice(0, 10);

export default function OfferIntakeModal({ listingId, offer, initial, onClose, onSaved }: Props) {
  const revision = Boolean(offer);
  const current = useMemo(() => (offer ? rowToTerms(offer) : null), [offer]);

  const [stage, setStage] = useState<'pick' | 'reading' | 'review'>('pick');
  const [files, setFiles] = useState<File[]>([]);
  const [kinds, setKinds] = useState<OfferDocKind[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState<AiResult | null>(null);
  const [readMsg, setReadMsg] = useState('');

  const [terms, setTerms] = useState<OfferTerms>(current ?? EMPTY_TERMS);
  const [keepTwo, setKeepTwo] = useState(true);
  const [receivedOn, setReceivedOn] = useState(today());
  const [kind, setKind] = useState<VersionKind>('counteroffer');
  const [label, setLabel] = useState('');
  const [summary, setSummary] = useState('');
  const [viewer, setViewer] = useState<{ index: number; page: number }>({ index: 0, page: 1 });

  // Local previews of the chosen PDFs, for the side-by-side view. Revoked when the files change or the window closes.
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  // Files go straight to private storage (no size limit from the app server), once; reading and saving both reuse them.
  const uploadedRef = useRef(new Map<File, UploadedFile>());
  const ensureUploaded = async (list: File[]): Promise<UploadedFile[]> => {
    const missing = list.filter((f) => !uploadedRef.current.has(f));
    if (missing.length) {
      const up = await uploadIncoming(missing);
      missing.forEach((f, i) => uploadedRef.current.set(f, up[i]));
    }
    return list.map((f) => uploadedRef.current.get(f) as UploadedFile);
  };

  // Opening a held offer email: fetch its files so they can be shown next to the terms. They are already in
  // storage, so they count as uploaded and are not sent again.
  const [opening, setOpening] = useState(Boolean(initial));
  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded: File[] = [];
        for (const f of initial.files) {
          if (!f.url) continue;
          const res = await fetch(f.url);
          if (!res.ok) throw new Error('open failed');
          const blob = await res.blob();
          const file = new File([blob], f.name, { type: blob.type });
          uploadedRef.current.set(file, { name: f.name, path: f.path });
          loaded.push(file);
        }
        if (cancelled) return;
        if (loaded.length === 0) throw new Error('no files');
        setFiles(loaded);
        setKinds(loaded.map((_, i) => (i === 0 ? 'purchase_contract' : 'addendum')));
      } catch {
        if (!cancelled) setError('Could not open the files from that email. Close this window and try again.');
      } finally {
        if (!cancelled) setOpening(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).slice(0, 8);
    setFiles(picked);
    setKinds(picked.map((_, i) => (revision ? 'addendum' : i === 0 ? 'purchase_contract' : 'addendum')));
    setError('');
  };

  const read = async () => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setReadMsg('No PDF to read, so enter the terms below. Your files are still attached to the offer.');
      setStage('review');
      return;
    }
    setStage('reading');
    setError('');
    try {
      // The reader sees PDFs only; keep indexes aligned with the full list for the page links.
      const uploads = await ensureUploaded(pdfs);
      const res = await authFetch(`/api/listings/${listingId}/offers/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploads, ...(current ? { currentTerms: current } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReadMsg(data.error || 'Could not read the documents. You can enter the terms yourself.');
        setStage('review');
        return;
      }
      // Map the reader's indexes (PDF order) back onto the full file list.
      const pdfIndex = files.map((f, i) => (pdfs.includes(f) ? i : -1)).filter((i) => i >= 0);
      const remap = (i: number) => pdfIndex[i] ?? 0;
      const result: AiResult = {
        ...data,
        documents: (data.documents || []).map((d: AiResult['documents'][number]) => ({ ...d, index: remap(d.index) })),
        references: Object.fromEntries(Object.entries(data.references || {}).map(([k, v]) => [k, { ...(v as { document: number; page: number }), document: remap((v as { document: number }).document) }])),
      };
      setAi(result);
      setTerms(normalizeTerms({ ...(current ?? {}), ...result.final }));
      setKinds((prev) => prev.map((k, i) => (OFFER_DOC_KINDS.includes((result.documents.find((d) => d.index === i)?.kind || '') as OfferDocKind) ? (result.documents.find((d) => d.index === i)!.kind as OfferDocKind) : k)));
      setSummary(result.changesSummary || '');
      if (revision) setKind((['counteroffer', 'amendment', 'revised_offer'].includes(result.revisionKind) ? result.revisionKind : 'amendment') as VersionKind);
      setKeepTwo(Boolean(result.original && diffTerms(result.original, result.final).length > 0));
      const firstRef = Object.values(result.references)[0];
      if (firstRef) setViewer({ index: firstRef.document, page: firstRef.page || 1 });
      setReadMsg(
        result.notes
          ? `Read ${pdfs.length} document${pdfs.length === 1 ? '' : 's'}. ${result.notes}`
          : `Read ${pdfs.length} document${pdfs.length === 1 ? '' : 's'}. Check each term against the document before saving.`
      );
      setStage('review');
    } catch (err) {
      setReadMsg(err instanceof Error && /upload/i.test(err.message) ? err.message : 'Could not read the documents. You can enter the terms yourself.');
      setStage('review');
    }
  };

  const setTerm = (key: TermKey, value: string) => setTerms((prev) => ({ ...prev, [key]: value }));

  const changes = useMemo(() => (current ? diffTerms(current, terms) : []), [current, terms]);
  const twoVersionChanges = useMemo(() => (ai?.original ? diffTerms(ai.original, terms) : []), [ai, terms]);
  const changedKeys = new Set(changes.map((c) => c.key));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const uploads = await ensureUploaded(files);
      const payload: Record<string, unknown> = { terms, docKinds: kinds, summary };
      if (initial && !revision) payload.inboundId = initial.inboundId;
      if (revision) {
        payload.kind = kind;
        payload.label = label;
      } else {
        payload.receivedOn = receivedOn;
        if (ai?.original && keepTwo && twoVersionChanges.length > 0) payload.originalTerms = ai.original;
      }
      const url = revision ? `/api/listings/${listingId}/offers/${offer!.id}/versions` : `/api/listings/${listingId}/offers/intake`;
      const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploads, payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      onSaved(revision ? 'Saved as a new version. The earlier terms are kept in the history.' : 'Offer saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  };

  const viewerUrl = urls[viewer.index];
  const viewerIsPdf = files[viewer.index] && (files[viewer.index].type === 'application/pdf' || files[viewer.index].name.toLowerCase().endsWith('.pdf'));

  const refButton = (key: string) => {
    const r = ai?.references[key];
    if (!r) return null;
    return (
      <button type="button" onClick={() => setViewer({ index: r.document, page: r.page || 1 })} className="text-[11px] text-blue-400 hover:text-blue-300 ml-2 normal-case tracking-normal font-normal">
        {r.page ? `p. ${r.page}` : 'see document'}
        {files.length > 1 ? ` · doc ${r.document + 1}` : ''} ↗
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true">
      <div className={`w-full ${stage === 'review' ? 'max-w-6xl' : 'max-w-lg'} max-h-[94vh] flex flex-col bg-slate-800 border border-slate-600 rounded-xl`}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-slate-100">{revision ? 'Counteroffer, amendment or revised offer' : 'Add an offer from its documents'}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
        </div>

        {stage !== 'review' && (
          <div className="p-5 space-y-3 overflow-y-auto">
            <p className="text-sm text-slate-400">
              {revision
                ? 'Upload the counteroffer, amendment or revised offer. Relay works out which terms changed, you check them, and the earlier terms stay in the offer’s history.'
                : 'Upload the signed contract and any addenda (up to 8 files). Relay reads the terms and shows them next to the document so you can check each one before anything is saved.'}
            </p>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff"
              disabled={stage === 'reading' || opening}
              onChange={(e) => pickFiles(e.target.files)}
              className="block w-full text-xs text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-slate-700 file:text-slate-100 file:text-xs"
            />
            {opening && <p className="text-sm text-blue-300">Opening the files from the email…</p>}
            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-slate-200">{f.name}</span>
                    <select value={kinds[i]} onChange={(e) => setKinds((prev) => prev.map((k, j) => (j === i ? (e.target.value as OfferDocKind) : k)))} className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-100">
                      {OFFER_DOC_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {OFFER_DOC_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {stage === 'reading' && <p className="text-sm text-blue-300">Reading {files.length} file{files.length === 1 ? '' : 's'}… this can take up to a minute.</p>}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="button" onClick={read} disabled={files.length === 0 || stage === 'reading'} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                Read the documents
              </button>
              <button
                type="button"
                disabled={stage === 'reading'}
                onClick={() => {
                  setReadMsg(files.length ? 'Enter the terms below. Your files will be attached to the offer.' : '');
                  setStage('review');
                }}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                {files.length ? 'Skip reading, enter terms myself' : 'Enter terms without a document'}
              </button>
            </div>
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="grid lg:grid-cols-2 gap-0 min-h-0 flex-1 overflow-hidden">
              {/* Source documents */}
              <div className="hidden lg:flex flex-col min-h-0 border-r border-slate-700">
                {files.length > 1 && (
                  <div className="flex flex-wrap gap-1 p-2 border-b border-slate-700">
                    {files.map((f, i) => (
                      <button key={i} type="button" onClick={() => setViewer({ index: i, page: 1 })} className={`text-xs px-2 py-1 rounded ${viewer.index === i ? 'bg-blue-500/20 text-blue-300' : 'text-slate-400 hover:text-slate-200'}`}>
                        {i + 1}. {f.name.length > 24 ? `${f.name.slice(0, 22)}…` : f.name}
                      </button>
                    ))}
                  </div>
                )}
                {viewerUrl && viewerIsPdf ? (
                  <iframe key={`${viewer.index}-${viewer.page}`} src={`${viewerUrl}#page=${viewer.page}`} title="Offer document" className="flex-1 w-full bg-slate-900 min-h-[40vh]" />
                ) : (
                  <div className="flex-1 flex items-center justify-center p-6 text-sm text-slate-500 text-center">{files.length ? 'This file type can’t be previewed here. It will still be saved with the offer.' : 'No document attached.'}</div>
                )}
              </div>

              {/* Terms */}
              <div className="overflow-y-auto p-5 space-y-3">
                {readMsg && <p className="text-sm text-slate-300">{readMsg}</p>}
                {revision && changes.length > 0 && (
                  <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200">
                    <p className="font-semibold mb-1">What changes from the current terms</p>
                    <ul className="space-y-0.5">
                      {changes.map((c) => (
                        <li key={c.key}>
                          {c.label}: {c.from} → {c.to}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {revision && changes.length === 0 && <p className="text-sm text-slate-400">No term differs from what is on file yet. Edit the terms below if the document changes any.</p>}

                {!revision && ai?.original && twoVersionChanges.length > 0 && (
                  <label className="flex items-start gap-2 rounded-lg border border-slate-600 bg-slate-900/40 p-3 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={keepTwo} onChange={(e) => setKeepTwo(e.target.checked)} className="accent-blue-500 mt-1" />
                    <span>
                      Keep the contract as first written and the amended terms as two versions
                      <span className="block text-xs text-slate-500 mt-0.5">The addenda changed: {twoVersionChanges.map((c) => c.label.toLowerCase()).join(', ')}.</span>
                    </span>
                  </label>
                )}

                {TERM_FIELDS.map((f) => {
                  const warn = ai?.uncertain[f.key];
                  const changed = revision && changedKeys.has(f.key);
                  const cls = `${inputCls} ${warn ? 'border-amber-600' : changed ? 'border-amber-500/70' : ''}`;
                  return (
                    <div key={f.key}>
                      <label className={labelCls}>
                        {f.label}
                        {refButton(f.key)}
                      </label>
                      {f.kind === 'financing' ? (
                        <select className={cls} value={terms.financing} onChange={(e) => setTerm('financing', e.target.value)}>
                          <option value="">Not stated</option>
                          {FINANCING_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      ) : f.kind === 'longtext' ? (
                        <textarea className={cls} rows={2} value={terms[f.key]} onChange={(e) => setTerm(f.key, e.target.value)} />
                      ) : f.kind === 'date' ? (
                        <input className={cls} type="date" value={terms[f.key]} onChange={(e) => setTerm(f.key, e.target.value)} />
                      ) : (
                        <input
                          className={cls}
                          inputMode={f.kind === 'money' || f.kind === 'int' ? 'decimal' : undefined}
                          value={terms[f.key]}
                          onChange={(e) => setTerm(f.key, e.target.value)}
                          placeholder={f.kind === 'money' ? '0' : ''}
                        />
                      )}
                      {warn && <p className="text-xs text-amber-300 mt-1">Check this: {warn}</p>}
                      {changed && current && <p className="text-xs text-slate-500 mt-1">Was: {formatTerm(f.key, current[f.key])}</p>}
                    </div>
                  );
                })}

                {revision ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>This is a</label>
                        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as VersionKind)}>
                          {(['counteroffer', 'amendment', 'revised_offer'] as VersionKind[]).map((k) => (
                            <option key={k} value={k}>
                              {VERSION_KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Name (optional)</label>
                        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Seller counter #1" maxLength={120} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>What changed</label>
                      <textarea className={inputCls} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A line for the history. Left blank, the changed terms are listed for you." />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className={labelCls}>Received on</label>
                    <input className={inputCls} type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                  </div>
                )}

                {files.length > 0 && (
                  <div>
                    <label className={labelCls}>Documents</label>
                    <ul className="space-y-1.5">
                      {files.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="flex-1 min-w-0 truncate text-slate-300">{f.name}</span>
                          <select value={kinds[i]} onChange={(e) => setKinds((prev) => prev.map((k, j) => (j === i ? (e.target.value as OfferDocKind) : k)))} className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-100">
                            {OFFER_DOC_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {OFFER_DOC_KIND_LABEL[k]}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-t border-slate-700">
              <button type="button" onClick={save} disabled={saving} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : revision ? 'Save as a new version' : 'Save offer'}
              </button>
              <button type="button" onClick={() => setStage('pick')} disabled={saving} className="text-sm text-slate-400 hover:text-slate-200">
                Back
              </button>
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
