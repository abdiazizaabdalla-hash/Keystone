'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { addTemplatesToDeal, summarizeAdded } from '@/lib/addTemplatesClient';
import { categoryLabel } from '@/lib/documentTaxonomy';
import { US_STATES } from '@/lib/usStates';

// "Add from Library": choose one or more PDF templates and put a copy of each in this deal's (or listing's) Documents. The deal's own
// state comes first, then the brokerage's templates, then PDFs for every state, then the other states. Each copy is the deal's own file:
// changing or removing it never touches the library, and each files itself under the category it was saved with.

interface Pdf { id: string; name: string; states: string[]; document_category?: string | null; document_type?: string | null; file_name: string | null; from_brokerage?: boolean; shared_by?: string }
interface Group { key: string; title: string; note?: string; items: Pdf[]; open: boolean }

const stateName = (code: string) => US_STATES.find((s) => s.code === code)?.name ?? code;

export default function LibraryPicker({ target, dealState, onClose, onAdded }: { target: { kind: 'deal' | 'listing'; id: string }; dealState?: string | null; onClose: () => void; onAdded: (message: string) => void }) {
  const [items, setItems] = useState<Pdf[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const where = target.kind === 'deal' ? 'deal' : 'listing';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/templates?kinds=form');
        if (!res.ok) throw new Error('Could not load your library');
        const rows = (await res.json()) as Pdf[];
        if (!cancelled) setItems(rows.filter((r) => r.file_name));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your library');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo<Group[]>(() => {
    const query = q.trim().toLowerCase();
    const list = (items ?? []).filter((t) => !query || `${t.name} ${t.file_name ?? ''} ${t.states.map(stateName).join(' ')}`.toLowerCase().includes(query));
    const mine = (t: Pdf) => !t.from_brokerage;
    const out: Group[] = [];
    const used = new Set<string>();
    const take = (pred: (t: Pdf) => boolean) => {
      const got = list.filter((t) => !used.has(t.id) && pred(t));
      got.forEach((t) => used.add(t.id));
      return got;
    };
    if (dealState) {
      const g = take((t) => mine(t) && t.states.includes(dealState));
      out.push({ key: `s-${dealState}`, title: `${stateName(dealState)} (this ${where}’s state)`, items: g, open: true });
    }
    const brokerage = take((t) => !!t.from_brokerage);
    if (brokerage.length) out.push({ key: 'brokerage', title: 'From your brokerage', items: brokerage, open: true });
    const everywhere = take((t) => t.states.length === 0);
    if (everywhere.length) out.push({ key: 'all', title: 'All states', items: everywhere, open: true });
    const byState = new Map<string, Pdf[]>();
    for (const t of list.filter((x) => !used.has(x.id))) for (const s of t.states.length ? [t.states[0]] : []) byState.set(s, [...(byState.get(s) ?? []), t]);
    for (const [code, got] of [...byState.entries()].sort((a, b) => stateName(a[0]).localeCompare(stateName(b[0])))) out.push({ key: `s-${code}`, title: stateName(code), items: got, open: !!query });
    return out;
  }, [items, q, dealState, where]);

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const openPreview = async (t: Pdf) => {
    setPreviewError('');
    try {
      const res = await authFetch(`/api/templates/${t.id}/file`);
      const data = (await res.json().catch(() => ({}))) as { url?: string | null };
      if (!res.ok || !data.url) throw new Error('Could not open that PDF');
      setPreview({ name: t.name, url: data.url });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Could not open that PDF');
    }
  };

  const attach = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    setError('');
    try {
      if (target.kind === 'deal') {
        onAdded(summarizeAdded(await addTemplatesToDeal(target.id, picked, false)));
      } else {
        const res = await authFetch('/api/templates/add-to-listing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: target.id, templateIds: picked }) });
        const json = (await res.json().catch(() => ({}))) as { error?: string; added?: { name: string }[]; skipped?: { name: string; reason: string }[] };
        if (!res.ok) throw new Error(json.error || 'Could not add those to this listing');
        const added = json.added ?? [];
        const skipped = json.skipped ?? [];
        onAdded([added.length ? (added.length === 1 ? `Added “${added[0].name}” to this listing’s Documents.` : `Added ${added.length} PDFs to this listing’s Documents.`) : 'Nothing was added.', skipped.length ? `Left out: ${skipped.map((s) => `${s.name} (${s.reason.replace(/\.$/, '').toLowerCase()})`).join('; ')}.` : ''].filter(Boolean).join(' '));
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those');
    } finally {
      setBusy(false);
    }
  };

  const row = (t: Pdf) => (
    <li key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5">
      <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
        <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} className="shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm text-slate-100 font-medium truncate">{t.name}</span>
          <span className="block text-xs text-slate-500 truncate">{categoryLabel(t.document_category ?? 'other') === 'Uncategorized' ? 'General' : categoryLabel(t.document_category ?? 'other')}{t.states.length ? ` · ${t.states.join(', ')}` : ''}{t.shared_by ? ` · from ${t.shared_by}` : ''}</span>
        </span>
      </label>
      <button type="button" onClick={() => void openPreview(t)} className="shrink-0 text-xs px-2.5 py-1 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg">Preview</button>
    </li>
  );

  const total = (items ?? []).length;
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="library-picker-title" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-2xl bg-slate-800 border border-white/10 rounded-2xl shadow-xl my-auto flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="library-picker-title" className="text-xl font-bold text-slate-100">Add from Library</h2>
              <p className="text-sm text-slate-400">Pick PDFs from your template library. Each is copied into this {where}’s Documents and filed under its category.</p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="text-slate-400 hover:text-slate-200 text-sm shrink-0">Close</button>
          </div>
          <input className="mt-3 w-full bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none" placeholder="Search PDFs or states" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
        </div>

        <div className="px-3 overflow-y-auto flex-1 min-h-[12rem]">
          {error && <p className="mx-2 mb-2 text-sm text-red-300">{error}</p>}
          {previewError && <p className="mx-2 mb-2 text-sm text-red-300">{previewError}</p>}
          {items === null && !error ? (
            <p className="px-3 py-6 text-sm text-slate-400">Loading your library…</p>
          ) : total === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-slate-200 font-semibold">Your library has no PDFs yet.</p>
              <p className="text-sm text-slate-400 mt-1">Upload your first one in Templates. State folders can stay empty until you have the right PDF.</p>
              <a href="/dashboard/templates" className="inline-block mt-3 text-sm text-blue-300 hover:text-blue-200">Open Templates →</a>
            </div>
          ) : (
            groups.map((g) => (
              <details key={g.key} open={g.open} className="mb-2">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>{g.title}</span>
                  <span className="text-slate-500 normal-case tracking-normal">{g.items.length}</span>
                </summary>
                {g.items.length === 0 ? <p className="px-3 pb-2 text-sm text-slate-500">No PDFs for this state yet. Upload one in Templates.</p> : <ul>{g.items.map(row)}</ul>}
              </details>
            ))
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-400">{picked.length ? `${picked.length} selected` : 'Select one or more'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100">Cancel</button>
            <button type="button" onClick={attach} disabled={picked.length === 0 || busy} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {busy ? 'Adding…' : picked.length > 1 ? `Add ${picked.length} PDFs` : 'Add to this ' + where}
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={(e) => { e.stopPropagation(); setPreview(null); }}>
          <div className="w-full max-w-4xl h-[85vh] bg-slate-900 border border-white/10 rounded-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
              <span className="text-sm font-semibold text-slate-100 truncate">{preview.name}</span>
              <button type="button" onClick={() => setPreview(null)} className="text-sm text-slate-400 hover:text-slate-200">Close preview</button>
            </div>
            <iframe src={preview.url} title={`Preview of ${preview.name}`} className="flex-1 w-full rounded-b-2xl bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
