'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { US_STATES } from '@/lib/usStates';

export interface DocTemplate {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  category: string;
  states: string[];
  file_name: string | null;
  archived: boolean;
  last_used_at?: string | null;
}

interface TrecForm {
  slug: string;
  name: string;
  formId: string;
  section: 'contracts' | 'addenda' | 'other';
  effectiveDate: string | null;
  previousFormId: string | null;
  changedAt: string | null;
  url: string;
  pinned: boolean;
}

interface TrecData {
  listUrl: string;
  lastCheckedOk: string | null;
  lastError: string | null;
  forms: TrecForm[];
}

interface Pin {
  kind: 'folder' | 'template' | 'trec';
  ref: string;
}

type Folder = null | string; // null = home, 'every' = templates with no state, otherwise a state code

const SECTION_LABEL: Record<TrecForm['section'], string> = { contracts: 'Contracts', addenda: 'Addenda', other: 'Other forms' };
const stateName = (code: string) => US_STATES.find((s) => s.code === code)?.name ?? code;
const folderName = (f: string) => (f === 'every' ? 'General' : stateName(f));
const shortDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const isRecent = (iso: string | null, days = 90) => !!iso && Date.now() - new Date(iso).getTime() < days * 86400000;

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none';

function Star({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={on} title={label} className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition ${on ? 'text-amber-300 hover:text-amber-200' : 'text-slate-500 hover:text-slate-200'}`}>
      <svg viewBox="0 0 20 20" className="w-5 h-5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
        <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.4l-4.6 2.5.9-5.2L2.5 8l5.2-.8L10 2.5z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// Documents: pinned things and recently used on top, then folders by state. Texas holds TREC's official forms (as links
// to TREC's own pages, so they are always the current version) next to your own Texas templates.
export default function DocumentsLibrary({ reloadKey, showArchived, onEdit }: { reloadKey: number; showArchived: boolean; onEdit: (t: DocTemplate) => void }) {
  const [templates, setTemplates] = useState<DocTemplate[] | null>(null);
  const [trec, setTrec] = useState<TrecData | null>(null);
  const [trecError, setTrecError] = useState('');
  const [pins, setPins] = useState<Pin[]>([]);
  const [folder, setFolder] = useState<Folder>(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tRes, trRes, pRes] = await Promise.all([
          authFetch(`/api/templates?kinds=letter,form${showArchived ? '&archived=1' : ''}`),
          authFetch('/api/templates/trec'),
          authFetch('/api/templates/pins'),
        ]);
        if (cancelled) return;
        if (!tRes.ok) throw new Error('Could not load your documents');
        setTemplates((await tRes.json()) as DocTemplate[]);
        if (trRes.ok) {
          setTrec((await trRes.json()) as TrecData);
          setTrecError('');
        } else {
          setTrecError(((await trRes.json().catch(() => ({}))) as { error?: string }).error || 'Could not load the Texas forms');
        }
        if (pRes.ok) setPins((await pRes.json()) as Pin[]);
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your documents');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, localKey, showArchived]);

  const isPinned = useCallback((kind: Pin['kind'], ref: string) => pins.some((p) => p.kind === kind && p.ref === ref), [pins]);
  const togglePin = async (kind: Pin['kind'], ref: string) => {
    const on = isPinned(kind, ref);
    setPins((cur) => (on ? cur.filter((p) => !(p.kind === kind && p.ref === ref)) : [...cur, { kind, ref }]));
    const res = on
      ? await authFetch(`/api/templates/pins?kind=${kind}&ref=${encodeURIComponent(ref)}`, { method: 'DELETE' })
      : await authFetch('/api/templates/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ref }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Could not change the pin');
      setLocalKey((k) => k + 1);
    }
  };

  const all = templates ?? [];
  const byFolder = useMemo(() => {
    const map = new Map<string, DocTemplate[]>();
    for (const t of all) {
      const keys = t.states.length === 0 ? ['every'] : t.states;
      for (const k of keys) map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [all]);
  const trecForms = trec?.forms ?? [];
  const recent = [...all].filter((t) => t.last_used_at).sort((a, b) => (b.last_used_at! > a.last_used_at! ? 1 : -1)).slice(0, 5);
  const count = (code: string) => (byFolder.get(code)?.length ?? 0) + (code === 'TX' ? trecForms.length : 0);

  const templateCard = (t: DocTemplate) => (
    <div key={`t-${t.id}`} className="flex items-stretch bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl transition min-w-0">
      <button type="button" onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-slate-100 font-semibold truncate">{t.name}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border bg-blue-500/20 text-blue-300 border-blue-500/40 shrink-0">{t.kind === 'form' ? 'Form' : 'Letter'}</span>
        </div>
        {t.description && <span className="block text-xs text-slate-400 mt-0.5 line-clamp-1">{t.description}</span>}
        <span className="block text-xs text-slate-500 mt-2 truncate">
          {t.states.length === 0 ? 'General' : t.states.slice(0, 4).join(', ') + (t.states.length > 4 ? ` +${t.states.length - 4}` : '')}
          {t.kind === 'form' && (t.file_name ? ` · ${t.file_name}` : ' · no file yet')}
          {t.archived ? ' · archived' : ''}
        </span>
      </button>
      <div className="pr-2 pt-2">
        <Star on={isPinned('template', t.id)} onClick={() => togglePin('template', t.id)} label={isPinned('template', t.id) ? 'Unpin' : 'Pin to the top'} />
      </div>
    </div>
  );

  const trecRow = (f: TrecForm) => (
    <div key={`trec-${f.slug}`} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl pl-4 pr-2 py-2.5 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-100 font-medium break-words">{f.name}</div>
        <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Form {f.formId}</span>
          {f.effectiveDate && <span>· effective {shortDate(f.effectiveDate)}</span>}
          {f.previousFormId && isRecent(f.changedAt) && <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 font-medium">Updated, was {f.previousFormId}</span>}
        </div>
      </div>
      <a href={f.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-200 hover:text-blue-300 rounded-lg transition whitespace-nowrap">
        Open on TREC ↗
      </a>
      <Star on={isPinned('trec', f.slug)} onClick={() => togglePin('trec', f.slug)} label={isPinned('trec', f.slug) ? 'Unpin' : 'Pin to the top'} />
    </div>
  );

  const trecNote = () => (
    <p className="text-xs text-slate-500">
      These open on TREC’s own site, which always shows the current version of each form. Relay does not keep copies.{' '}
      {trecError ? (
        <span className="text-amber-300">{trecError}</span>
      ) : trec?.lastError ? (
        <span className="text-amber-300">Could not check TREC just now, so this is the last list Relay saw{trec.lastCheckedOk ? ` (${shortDate(trec.lastCheckedOk)})` : ''}.</span>
      ) : trec?.lastCheckedOk ? (
        <>Checked against TREC on {shortDate(trec.lastCheckedOk)}.</>
      ) : null}
    </p>
  );

  const folderTile = (code: string, featured = false) => {
    const n = count(code);
    return (
      <div key={`f-${code}`} className={`flex items-stretch rounded-2xl border transition min-w-0 ${featured ? 'bg-blue-500/10 border-blue-500/40 hover:border-blue-400' : 'bg-white/5 border-white/10 hover:border-white/25'}`}>
        <button type="button" onClick={() => setFolder(code)} className="flex-1 min-w-0 text-left p-4">
          <span className="flex items-center gap-2 text-slate-100 font-semibold">
            <svg viewBox="0 0 20 20" className="w-5 h-5 text-blue-300 shrink-0" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h3.6a1 1 0 01.7.3L10 6h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            <span className="truncate">{folderName(code)}</span>
          </span>
          <span className="block text-xs text-slate-400 mt-1">
            {code === 'TX' ? `${trecForms.length} official TREC form${trecForms.length === 1 ? '' : 's'} · ${byFolder.get('TX')?.length ?? 0} of yours` : `${n} template${n === 1 ? '' : 's'}`}
          </span>
        </button>
        <div className="pr-2 pt-2">
          <Star on={isPinned('folder', code)} onClick={() => togglePin('folder', code)} label={isPinned('folder', code) ? 'Unpin folder' : 'Pin folder to the top'} />
        </div>
      </div>
    );
  };

  if (templates === null && !error) return <div className="text-slate-400">Loading…</div>;

  const query = q.trim().toLowerCase();
  const searchHits = query
    ? {
        templates: all.filter((t) => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(query)),
        trec: trecForms.filter((f) => `${f.name} ${f.formId}`.toLowerCase().includes(query)),
      }
    : null;

  const header = (
    <input className={inputCls} placeholder="Search your documents and Texas forms" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
  );

  let body: React.ReactNode;
  if (searchHits) {
    body = (
      <div className="space-y-5">
        {searchHits.templates.length === 0 && searchHits.trec.length === 0 && <p className="text-sm text-slate-400">Nothing matches “{q}”.</p>}
        {searchHits.templates.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your documents</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{searchHits.templates.map((t) => templateCard(t))}</div>
          </section>
        )}
        {searchHits.trec.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Official TREC forms</h2>
            <div className="grid lg:grid-cols-2 gap-2">{searchHits.trec.map((f) => trecRow(f))}</div>
          </section>
        )}
      </div>
    );
  } else if (folder) {
    const mine = byFolder.get(folder) ?? [];
    const grouped = (['contracts', 'addenda', 'other'] as const).map((s) => ({ s, rows: trecForms.filter((f) => f.section === s) })).filter((g) => g.rows.length > 0);
    body = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setFolder(null)} className="text-sm text-slate-400 hover:text-slate-200">
            ← All folders
          </button>
          <div className="flex items-center gap-1 text-sm text-slate-300">
            {isPinned('folder', folder) ? 'Pinned to the top' : 'Pin this folder'}
            <Star on={isPinned('folder', folder)} onClick={() => togglePin('folder', folder)} label={isPinned('folder', folder) ? 'Unpin folder' : 'Pin folder to the top'} />
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-slate-100">{folderName(folder)}</h2>

        {folder === 'TX' && (
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Official TREC forms</h3>
              {trecNote()}
            </div>
            {trecForms.length === 0 ? (
              <p className="text-sm text-slate-400">The list of TREC forms is not available yet. Try again in a few minutes, or use TREC’s site directly.</p>
            ) : (
              grouped.map((g) => (
                <div key={g.s}>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    {SECTION_LABEL[g.s]} ({g.rows.length})
                  </h4>
                  <div className="grid lg:grid-cols-2 gap-2">{g.rows.map((f) => trecRow(f))}</div>
                </div>
              ))
            )}
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold text-slate-200 mb-2">{folder === 'TX' ? 'Your Texas templates' : folder === 'every' ? 'General templates (any state)' : `Your ${stateName(folder)} templates`}</h3>
          {mine.length === 0 ? (
            <p className="text-sm text-slate-400">
              {folder === 'every' ? 'Nothing here yet. Letters and forms with no state chosen show up here.' : `Nothing yet. Upload a form or write a letter and tag it with ${stateName(folder)}, and it will appear here.`}
              {folder !== 'TX' && folder !== 'every' && ' Official form lists for other states are not built in yet.'}
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{mine.map((t) => templateCard(t))}</div>
          )}
        </section>
      </div>
    );
  } else {
    const pinnedFolders = pins.filter((p) => p.kind === 'folder').map((p) => p.ref);
    const pinnedTemplates = all.filter((t) => isPinned('template', t.id));
    const pinnedTrec = trecForms.filter((f) => isPinned('trec', f.slug));
    const hasPins = pinnedFolders.length + pinnedTemplates.length + pinnedTrec.length > 0;
    const stateFolders = [...byFolder.keys()].filter((k) => k !== 'every' && k !== 'TX' && !pinnedFolders.includes(k)).sort();
    body = (
      <div className="space-y-7">
        {hasPins && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pinned</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {pinnedFolders.map((code) => folderTile(code, code === 'TX'))}
              {pinnedTemplates.map((t) => templateCard(t))}
            </div>
            {pinnedTrec.length > 0 && <div className="grid lg:grid-cols-2 gap-2 mt-3">{pinnedTrec.map((f) => trecRow(f))}</div>}
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Recently used</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{recent.map((t) => templateCard(t))}</div>
          </section>
        )}

        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Folders</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {!pinnedFolders.includes('TX') && folderTile('TX', true)}
            {!pinnedFolders.includes('every') && folderTile('every')}
            {stateFolders.map((code) => folderTile(code))}
          </div>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm text-blue-300 hover:text-blue-200 mt-3">
            {showAll ? 'Hide the list of states' : 'Show all states'}
          </button>
          {showAll && (
            <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-1.5">
              {US_STATES.map((s) => (
                <button key={s.code} type="button" onClick={() => setFolder(s.code)} title={s.name} className="text-left px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-200 truncate">
                  {s.code} <span className="text-xs text-slate-500">{count(s.code) > 0 ? count(s.code) : ''}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}
      {header}
      {body}
    </div>
  );
}
