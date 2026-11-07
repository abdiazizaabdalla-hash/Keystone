'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { DOCUMENT_CATEGORIES, typesForCategory } from '@/lib/documentTaxonomy';
import { US_STATES } from '@/lib/usStates';

// Upload one or more PDFs to the template library. First the PDFs are chosen (drag them in, or browse), then each is classified:
// is it a state-specific contract or form (saved in that state's folder), a brokerage template for every state (brokerage owners),
// or a general transaction document. Every PDF gets its own name and can be changed on its row. Nothing is saved until "Save".

type Scope = 'state' | 'brokerage' | 'general';
interface Row { key: string; file: File; name: string; error?: string; done?: boolean }

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5';
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export default function UploadPdfDialog({ presetState, presetName, initialFiles, onClose, onDone }: { presetState?: string | null; presetName?: string | null; initialFiles?: File[]; onClose: () => void; onDone: (saved: number) => void }) {
  const [rows, setRows] = useState<Row[]>(() => (initialFiles ?? []).filter(isPdf).map((f) => ({ key: fileKey(f), file: f, name: f.name.replace(/\.pdf$/i, '') })));
  const [scope, setScope] = useState<Scope | null>(presetState ? 'state' : null);
  const [state, setState] = useState(presetState ?? '');
  const [category, setCategory] = useState('contract_disclosures');
  const [type, setType] = useState(typesForCategory('contract_disclosures')[0]);
  const [canShare, setCanShare] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFeatureOnClient('brokerage')) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/oversight?check=1');
        if (!cancelled) setCanShare(res.ok);
      } catch {
        /* brokerage sharing is simply not offered */
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    const pdfs = list.filter(isPdf);
    setNotice(pdfs.length < list.length ? 'Only PDF files can go in the library. Other files were left out.' : '');
    setRows((cur) => {
      const have = new Set(cur.map((r) => r.key));
      return [...cur, ...pdfs.filter((f) => !have.has(fileKey(f))).map((f, i) => ({ key: fileKey(f), file: f, name: presetName && cur.length === 0 && i === 0 ? presetName : f.name.replace(/\.pdf$/i, '') }))];
    });
  };

  const pickScope = (s: Scope) => {
    setScope(s);
    if (s === 'brokerage') setShare(true);
  };

  const needsCategory = scope === 'state' || scope === 'general';
  const ready = rows.length > 0 && scope !== null && (scope !== 'state' || !!state) && rows.every((r) => r.name.trim());

  const save = async () => {
    if (!ready || !scope) return;
    setBusy(true);
    setNotice('');
    let saved = 0;
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (next[i].done) {
        saved += 1;
        continue;
      }
      const fd = new FormData();
      fd.append('file', next[i].file);
      fd.append('name', next[i].name.trim());
      fd.append('scope', scope);
      if (scope === 'state') fd.append('state', state);
      if (needsCategory || scope === 'brokerage') {
        fd.append('documentCategory', category);
        fd.append('documentType', type);
      }
      if (share) fd.append('share', 'true');
      try {
        const res = await authFetch('/api/templates/library', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Could not save that PDF');
        next[i] = { ...next[i], done: true, error: undefined };
        saved += 1;
      } catch (e) {
        next[i] = { ...next[i], error: e instanceof Error ? e.message : 'Could not save that PDF' };
      }
      setRows([...next]);
    }
    setBusy(false);
    if (next.every((r) => r.done)) onDone(saved);
    else setNotice(`${saved} saved. The ones marked below did not upload; fix them and save again.`);
  };

  const option = (s: Scope, title: string, text: string, disabled?: string) => (
    <button
      type="button"
      disabled={!!disabled}
      onClick={() => pickScope(s)}
      aria-pressed={scope === s}
      className={`text-left rounded-xl border p-3 transition ${scope === s ? 'border-blue-400 bg-blue-500/15' : 'border-white/10 bg-white/5 hover:border-white/30'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="block text-sm font-semibold text-slate-100">{title}</span>
      <span className="block text-xs text-slate-400 mt-0.5">{disabled || text}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="upload-pdf-title" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-2xl bg-slate-800 border border-white/10 rounded-2xl p-5 sm:p-6 shadow-xl my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="upload-pdf-title" className="text-xl font-bold text-slate-100">Upload PDFs</h2>
            <p className="text-sm text-slate-400">Add the PDFs you use on deals. Relay keeps them in your library and copies one into a deal when you add it.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-slate-400 hover:text-slate-200 text-sm shrink-0">Close</button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${drag ? 'border-blue-400 bg-blue-500/10' : 'border-white/20 bg-white/[0.03]'}`}
        >
          <p className="text-sm text-slate-200 font-medium">Drag PDFs here</p>
          <p className="text-xs text-slate-400 mb-3">or</p>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">Choose PDFs</button>
          <input ref={inputRef} type="file" multiple accept="application/pdf,.pdf" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} aria-label="Choose PDF files" />
          <p className="text-[11px] text-slate-500 mt-2">PDF only, up to 15 MB each.</p>
        </div>

        {rows.length > 0 && (
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                <input
                  className={inputCls}
                  value={r.name}
                  maxLength={140}
                  disabled={busy || r.done}
                  onChange={(e) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                  aria-label={`Name for ${r.file.name}`}
                />
                <span className="text-xs shrink-0 w-20 text-right">
                  {r.done ? <span className="text-emerald-300">Saved</span> : r.error ? <span className="text-red-300" title={r.error}>Failed</span> : <span className="text-slate-500">{(r.file.size / 1024 / 1024).toFixed(1)} MB</span>}
                </span>
                {!r.done && <button type="button" disabled={busy} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} className="text-xs text-slate-400 hover:text-red-300 shrink-0" aria-label={`Remove ${r.file.name}`}>Remove</button>}
              </li>
            ))}
            {rows.some((r) => r.error && !r.done) && <li className="text-xs text-red-300">{rows.find((r) => r.error && !r.done)?.error}</li>}
          </ul>
        )}

        <div className="mt-5">
          <div className={labelCls}>Is this a state-specific document?</div>
          <div className="grid sm:grid-cols-3 gap-2">
            {option('state', 'Yes, state-specific', 'A contract or form for one state. It is saved in that state’s folder.')}
            {option('brokerage', 'No, a brokerage template', 'For every state, shared with your brokerage’s agents.', canShare ? undefined : 'Only your broker can add brokerage templates.')}
            {option('general', 'No, a general document', 'For every state. Kept in your library, filed by category.')}
          </div>
        </div>

        {scope && (
          <div className="mt-4 grid sm:grid-cols-3 gap-3">
            {scope === 'state' && (
              <div>
                <label className={labelCls} htmlFor="upload-state">State</label>
                <select id="upload-state" className={inputCls} value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="">Choose a state…</option>
                  {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="upload-category">Category</label>
              <select id="upload-category" className={inputCls} value={category} onChange={(e) => { setCategory(e.target.value); setType(typesForCategory(e.target.value)[0]); }}>
                {DOCUMENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="upload-type">Document type</label>
              <select id="upload-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                {typesForCategory(category).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <p className="sm:col-span-3 text-xs text-slate-400 -mt-1">When you add one of these to a deal, it files itself under {DOCUMENT_CATEGORIES.find((c) => c.key === category)?.label}.</p>
            {canShare && scope !== 'brokerage' && (
              <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                Also share with my brokerage’s agents
              </label>
            )}
          </div>
        )}

        {notice && <p className="mt-3 text-sm text-amber-300">{notice}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100">Cancel</button>
          <button type="button" onClick={save} disabled={!ready || busy} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
            {busy ? 'Saving…' : rows.length > 1 ? `Save ${rows.length} PDFs` : 'Save PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
