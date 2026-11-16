'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { DOCUMENT_CATEGORIES } from '@/lib/documentTaxonomy';
import SelectAllToggle from '@/components/SelectAllToggle';

// Brokerage Pro: required-document lists by deal type. The default list (above, in File review) covers every file; each list here
// applies to files whose checklist template it names, for example "Cash" or "Condo".

interface List { name: string; templateNames: string[]; documentTypes: string[] }
interface Data { tier: 'basic' | 'pro'; maxLists: number; lists: List[]; templates: string[] }

const card = 'bg-white/5 border border-white/10 rounded-2xl';

export default function BrokerageDocumentLists({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<List[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await authFetch('/api/oversight/file-review/lists');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load the lists');
    setData(body);
    setDraft(body.lists);
    setDirty(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load the lists')); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const change = (i: number, patch: Partial<List>) => { setDraft((d) => d.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await authFetch('/api/oversight/file-review/lists', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lists: draft }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      await load();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (!data) return error ? <p className="text-sm text-red-300">{error}</p> : null;

  return (
    <div className={`${card} p-5`}>
      <p className="text-slate-100 font-semibold">Lists by deal type</p>
      {data.maxLists === 0 ? (
        <p className="text-sm text-slate-400 mt-1">Brokerage Pro lets you keep a different required-document list for each kind of deal, such as cash or condo. Basic uses the one list above for every file.</p>
      ) : (
        <>
          <p className="text-sm text-slate-400 mt-1">A list applies to files whose checklist template you tick. Every other file uses the default list above. Up to {data.maxLists} extra lists.</p>
          {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
          <div className="mt-4 space-y-3">
            {draft.map((l, i) => (
              <div key={i} className="rounded-xl border border-slate-700 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={l.name} onChange={(e) => change(i, { name: e.target.value })} maxLength={60} placeholder="List name, for example Cash" className="flex-1 min-w-[10rem] bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100" />
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} className="px-3 py-1.5 border border-slate-600 text-slate-200 text-xs font-semibold rounded-lg">{open === i ? 'Hide documents' : `Documents (${l.documentTypes.length})`}</button>
                  <button type="button" onClick={() => { setDraft((d) => d.filter((_, j) => j !== i)); setDirty(true); setOpen(null); }} className="px-3 py-1.5 text-xs text-red-300 hover:text-red-200">Remove</button>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Applies to files using these checklist templates<SelectAllToggle items={[...new Set([...data.templates, ...l.templateNames])]} selected={l.templateNames} onChange={(next) => change(i, { templateNames: next })} label="checklist templates" /></p>
                  {data.templates.length === 0 && l.templateNames.length === 0 ? (
                    <p className="text-xs text-slate-500">Your agents have no checklist templates on their deals yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {[...new Set([...data.templates, ...l.templateNames])].map((t) => (
                        <label key={t} className="flex items-center gap-1.5 text-sm text-slate-300">
                          <input type="checkbox" checked={l.templateNames.includes(t)} onChange={(e) => change(i, { templateNames: e.target.checked ? [...l.templateNames, t] : l.templateNames.filter((x) => x !== t) })} />
                          {t}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {open === i && (
                  <div className="grid md:grid-cols-2 gap-4">
                    {DOCUMENT_CATEGORIES.filter((c) => c.key !== 'other').map((c) => (
                      <fieldset key={c.key}>
                        <legend className="text-xs uppercase tracking-wider text-slate-500 mb-1">{c.label}<SelectAllToggle items={c.types} selected={l.documentTypes} onChange={(next) => change(i, { documentTypes: next })} label={c.label} /></legend>
                        {c.types.map((t) => (
                          <label key={t} className="flex items-center gap-2 text-sm text-slate-300 py-0.5">
                            <input type="checkbox" checked={l.documentTypes.includes(t)} onChange={(e) => change(i, { documentTypes: e.target.checked ? [...l.documentTypes, t] : l.documentTypes.filter((x) => x !== t) })} />
                            {t}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {draft.length < data.maxLists && (
              <button type="button" onClick={() => { setDraft((d) => [...d, { name: '', templateNames: [], documentTypes: [] }]); setOpen(draft.length); setDirty(true); }} className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-xs font-semibold rounded-lg">Add a list</button>
            )}
            <button type="button" disabled={saving || !dirty} onClick={save} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">{saving ? 'Saving…' : 'Save lists'}</button>
          </div>
        </>
      )}
    </div>
  );
}
