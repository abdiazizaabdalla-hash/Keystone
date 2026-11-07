'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { US_STATES } from '@/lib/usStates';
import { DOCUMENT_CATEGORIES, categoryLabel as docCategoryLabel } from '@/lib/documentTaxonomy';
import { FORM_SOURCES_CHECKED, findFormSource, formSourcesFor, STATE_FORM_INFO, TIER_LABEL, type FormSource, type SourceAccess, type SourceType, type StateTier } from '@/lib/stateFormSources';

export interface DocTemplate {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  category: string;
  states: string[];
  file_name: string | null;
  document_category?: string | null;
  document_type?: string | null;
  brokerage_shared?: boolean;
  archived: boolean;
  last_used_at?: string | null;
  /** Shared with you by the brokerage you belong to: pinned for you, usable, never editable here. */
  from_brokerage?: boolean;
  shared_by?: string;
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
  kind: 'folder' | 'template' | 'trec' | 'source' | 'custom';
  ref: string;
}

type ItemKind = 'template' | 'trec' | 'source';
type Mode = 'pdfs' | 'resources';

interface StateLink { id: string; state: string; label: string; url: string }

interface CustomFolder {
  id: string;
  name: string;
  items: { kind: ItemKind; ref: string }[];
}

// null = home, 'c:<id>' = one of your own folders, otherwise a state code
type Folder = null | string;
const customId = (f: string) => (f.startsWith('c:') ? f.slice(2) : null);

const TYPE_LABEL: Record<SourceType, string> = { state: 'State government', association: 'REALTOR association', other: 'Other provider' };
const TYPE_CLS: Record<SourceType, string> = {
  state: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  association: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  other: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};
const ACCESS_LABEL: Record<SourceAccess, string> = { public: 'Free', members: 'Members only', paid: 'Paid', mixed: 'Part free' };
const ACCESS_CLS: Record<SourceAccess, string> = {
  public: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  members: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  paid: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  mixed: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};
const TIER_DOT: Record<StateTier, string> = { contracts: 'bg-emerald-400', disclosures: 'bg-sky-400', association: 'bg-amber-400', none: 'bg-slate-600' };
const badge = 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border';

const SECTION_LABEL: Record<TrecForm['section'], string> = { contracts: 'Contracts', addenda: 'Addenda', other: 'Other forms' };
const stateName = (code: string) => US_STATES.find((s) => s.code === code)?.name ?? code;
const folderName = (f: string) => stateName(f);
const failMsg = async (res: Response, fallback: string) => ((await res.json().catch(() => ({}))) as { error?: string }).error || fallback;
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
export default function DocumentsLibrary({ reloadKey, showArchived, onEdit, onUpload, initialMode = 'pdfs', initialState = null }: { reloadKey: number; showArchived: boolean; onEdit: (t: DocTemplate) => void; onUpload: (presetState?: string | null) => void; initialMode?: Mode; initialState?: string | null }) {
  // Two kinds of thing live here and are never mixed: PDF Templates (real PDFs, copied into deals) and State Resources (links that open
  // a state's own forms pages; never attached to a deal).
  const [mode, setMode] = useState<Mode>(initialMode);
  const [links, setLinks] = useState<StateLink[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [templates, setTemplates] = useState<DocTemplate[] | null>(null);
  const [trec, setTrec] = useState<TrecData | null>(null);
  const [trecError, setTrecError] = useState('');
  const [pins, setPins] = useState<Pin[]>([]);
  const [folder, setFolder] = useState<Folder>(initialState);
  const [q, setQ] = useState('');
  const [pickStates, setPickStates] = useState(false);
  const [error, setError] = useState('');
  const [localKey, setLocalKey] = useState(0);
  const [folders, setFolders] = useState<CustomFolder[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tRes, trRes, pRes, fRes, lRes] = await Promise.all([
          authFetch(`/api/templates?kinds=form${showArchived ? '&archived=1' : ''}`),
          authFetch('/api/templates/trec'),
          authFetch('/api/templates/pins'),
          authFetch('/api/templates/folders'),
          authFetch('/api/templates/state-links'),
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
        if (fRes.ok) setFolders((await fRes.json()) as CustomFolder[]);
        if (lRes.ok) setLinks((await lRes.json()) as StateLink[]);
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

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-folder-menu]')) setMenuFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor]);

  const jsonHeaders = { 'Content-Type': 'application/json' };
  const makeFolder = async (name: string): Promise<CustomFolder | null> => {
    const res = await authFetch('/api/templates/folders', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name }) });
    if (!res.ok) {
      setError(await failMsg(res, 'Could not make the folder'));
      return null;
    }
    const f = (await res.json()) as CustomFolder;
    setFolders((cur) => [...cur, f]);
    setError('');
    return f;
  };
  const isIn = (f: CustomFolder, kind: ItemKind, ref: string) => f.items.some((i) => i.kind === kind && i.ref === ref);
  const toggleItem = async (f: CustomFolder, kind: ItemKind, ref: string) => {
    const on = isIn(f, kind, ref);
    setFolders((cur) => cur.map((x) => (x.id === f.id ? { ...x, items: on ? x.items.filter((i) => !(i.kind === kind && i.ref === ref)) : [...x.items, { kind, ref }] } : x)));
    const res = on
      ? await authFetch(`/api/templates/folders/${f.id}/items?kind=${kind}&ref=${encodeURIComponent(ref)}`, { method: 'DELETE' })
      : await authFetch(`/api/templates/folders/${f.id}/items`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ kind, ref }) });
    if (!res.ok) {
      setError(await failMsg(res, 'Could not change the folder'));
      setLocalKey((k) => k + 1);
    }
  };
  const renameFolder = async (f: CustomFolder, name: string) => {
    const res = await authFetch(`/api/templates/folders/${f.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ name }) });
    if (!res.ok) {
      setError(await failMsg(res, 'Could not rename the folder'));
      return;
    }
    const saved = ((await res.json()) as { name: string }).name;
    setFolders((cur) => cur.map((x) => (x.id === f.id ? { ...x, name: saved } : x)));
    setRenaming(null);
    setError('');
  };
  const deleteFolder = async (f: CustomFolder) => {
    const res = await authFetch(`/api/templates/folders/${f.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(await failMsg(res, 'Could not delete the folder'));
      return;
    }
    setFolders((cur) => cur.filter((x) => x.id !== f.id));
    setPins((cur) => cur.filter((p) => !(p.kind === 'custom' && p.ref === f.id)));
    setConfirmDelete(false);
    setFolder(null);
  };

  const everything = templates ?? [];
  const all = everything.filter((t) => !t.from_brokerage);
  const brokerageDocs = everything.filter((t) => t.from_brokerage);
  const byFolder = useMemo(() => {
    const map = new Map<string, DocTemplate[]>();
    for (const t of all) {
      for (const k of t.states) map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [all]);
  const trecForms = trec?.forms ?? [];
  const recent = [...all].filter((t) => t.last_used_at).sort((a, b) => (b.last_used_at! > a.last_used_at! ? 1 : -1)).slice(0, 5);
  const count = (code: string) => byFolder.get(code)?.length ?? 0;
  const linkCount = (code: string) => formSourcesFor(code).length + (code === 'TX' ? trecForms.length : 0) + links.filter((l) => l.state === code).length;

  const openPdf = async (t: DocTemplate, download: boolean) => {
    setFileNote('');
    try {
      const res = await authFetch(`/api/templates/${t.id}/file`);
      const data = (await res.json().catch(() => ({}))) as { url?: string | null };
      if (!res.ok || !data.url) throw new Error('Could not open that PDF');
      if (download) {
        const a = document.createElement('a');
        a.href = data.url;
        a.download = t.file_name || `${t.name}.pdf`;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      setFileNote(e instanceof Error ? e.message : 'Could not open that PDF');
    }
  };

  const saveLink = async (code: string) => {
    const res = await authFetch('/api/templates/state-links', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ state: code, label: linkLabel, url: linkUrl }) });
    if (!res.ok) {
      setError(await failMsg(res, 'Could not save that link'));
      return;
    }
    const row = (await res.json()) as StateLink;
    setLinks((cur) => [...cur, row]);
    setLinkLabel('');
    setLinkUrl('');
    setAddingLink(false);
    setError('');
  };
  const removeLink = async (id: string) => {
    setLinks((cur) => cur.filter((l) => l.id !== id));
    const res = await authFetch(`/api/templates/state-links?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(await failMsg(res, 'Could not remove that link'));
      setLocalKey((k) => k + 1);
    }
  };

  const removeBtn = (onClick: () => void, title = 'Take it out of this folder (the document itself stays)') => (
    <button type="button" onClick={onClick} className="text-[11px] text-slate-500 hover:text-red-300 px-1 leading-none" title={title}>
      Remove
    </button>
  );

  // The "add to one of my folders" button and its little menu.
  const addMenu = (kind: ItemKind, ref: string) => {
    const key = `${folder ?? 'home'}|${kind}:${ref}`; // tied to the folder on screen, so it closes when you move
    const open = menuFor === key;
    const inAny = folders.some((f) => isIn(f, kind, ref));
    return (
      <div className="relative shrink-0" data-folder-menu>
        <button
          type="button"
          onClick={() => {
            setMenuFor(open ? null : key);
            setNewName('');
          }}
          aria-label="Add to one of your folders"
          aria-expanded={open}
          title="Add to one of your folders"
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition ${inAny ? 'text-blue-300 hover:text-blue-200' : 'text-slate-500 hover:text-slate-200'}`}
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5" fill={inAny ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
            <path d="M2.5 6a2 2 0 012-2h3.1a1 1 0 01.7.3L10 6h5.5a2 2 0 012 2v6a2 2 0 01-2 2h-11a2 2 0 01-2-2V6z" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-9 z-30 w-64 bg-slate-900 border border-white/15 rounded-xl shadow-xl p-2">
            <div className="px-2 pt-1 pb-1 text-[11px] uppercase tracking-wider text-slate-500">Add to a folder</div>
            {folders.length === 0 && <p className="px-2 pb-2 text-xs text-slate-400">You have no folders yet. Name one below to make it.</p>}
            <div className="max-h-48 overflow-y-auto">
              {folders.map((f) => (
                <button key={f.id} type="button" onClick={() => toggleItem(f, kind, ref)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left text-slate-200 hover:bg-white/10">
                  <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${isIn(f, kind, ref) ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-500'}`}>{isIn(f, kind, ref) ? '✓' : ''}</span>
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
            <form
              className="flex gap-1 pt-2 mt-1 border-t border-white/10"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) return;
                const f = await makeFolder(name);
                if (f) {
                  setNewName('');
                  await toggleItem(f, kind, ref);
                }
              }}
            >
              <input className={`${inputCls} !py-1.5`} placeholder="New folder name" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} aria-label="New folder name" />
              <button type="submit" className="px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm">
                Make
              </button>
            </form>
          </div>
        )}
      </div>
    );
  };

  const templateCard = (t: DocTemplate, remove?: () => void) => (
    <div key={`t-${t.id}`} className="flex items-stretch bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl transition min-w-0">
      <button type="button" onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-slate-100 font-semibold truncate">{t.name}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border bg-blue-500/20 text-blue-300 border-blue-500/40 shrink-0">{t.kind === 'form' ? 'Form' : 'Letter'}</span>
        </div>
        {t.description && <span className="block text-xs text-slate-400 mt-0.5 line-clamp-1">{t.description}</span>}
        <span className="block text-xs text-slate-500 mt-2 truncate">
          {t.states.length === 0 ? 'All states' : t.states.slice(0, 4).join(', ') + (t.states.length > 4 ? ` +${t.states.length - 4}` : '')}
          {t.kind === 'form' && ` · ${docCategoryLabel(t.document_category ?? 'other') === 'Uncategorized' ? 'General' : docCategoryLabel(t.document_category ?? 'other')}`}
          {t.kind === 'form' && !t.file_name ? ' · no file yet' : ''}
          {t.archived ? ' · archived' : ''}
        </span>
        {t.kind === 'form' && t.file_name && (
          <span className="mt-2 flex gap-3 text-xs">
            <span role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); void openPdf(t, false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void openPdf(t, false); } }} className="text-blue-300 hover:text-blue-200">Preview</span>
            <span role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); void openPdf(t, true); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void openPdf(t, true); } }} className="text-blue-300 hover:text-blue-200">Download</span>
          </span>
        )}
      </button>
      <div className="pr-2 pt-2 flex flex-col items-center">
        <Star on={isPinned('template', t.id)} onClick={() => togglePin('template', t.id)} label={isPinned('template', t.id) ? 'Unpin' : 'Pin to the top'} />
        {addMenu('template', t.id)}
        {remove && removeBtn(remove)}
      </div>
    </div>
  );

  const trecRow = (f: TrecForm, remove?: () => void) => (
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
      {addMenu('trec', f.slug)}
      {remove && removeBtn(remove)}
    </div>
  );

  // One official or association forms source for a state: a link to their own page, never a copy.
  const sourceRow = (s: FormSource, opts?: { remove?: () => void; showState?: boolean }) => (
    <div key={`src-${s.id}`} className="flex items-start gap-2 bg-white/5 border border-white/10 rounded-xl pl-4 pr-2 py-2.5 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-100 font-medium break-words">
          {opts?.showState && <span className="text-slate-400">{stateName(s.state)}: </span>}
          {s.label}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className={`${badge} ${TYPE_CLS[s.type]}`}>{TYPE_LABEL[s.type]}</span>
          <span className={`${badge} ${ACCESS_CLS[s.access]}`}>{ACCESS_LABEL[s.access]}</span>
        </div>
        <div className="text-xs text-slate-300 mt-1.5">{s.covers}</div>
        {s.note && <div className="text-xs text-slate-500 mt-0.5">{s.note}</div>}
      </div>
      <a href={s.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-200 hover:text-blue-300 rounded-lg transition whitespace-nowrap">
        Open ↗
      </a>
      <Star on={isPinned('source', s.id)} onClick={() => togglePin('source', s.id)} label={isPinned('source', s.id) ? 'Unpin' : 'Pin to the top'} />
      {addMenu('source', s.id)}
      {opts?.remove && removeBtn(opts.remove)}
    </div>
  );

  const sourcesNote = () => (
    <p className="text-xs text-slate-500">
      Each link opens that source’s own page, so you always see their current version. Relay does not keep copies. Sources were last checked {shortDate(FORM_SOURCES_CHECKED)}. Pages can move, so a link may stop working.
    </p>
  );

  // A PDF a brokerage owner shared with the brokerage's agents: usable on any deal, never editable here.
  const brokerageCard = (t: DocTemplate) => (
    <div key={`b-${t.id}`} className="bg-white/5 border border-amber-400/30 rounded-2xl p-4 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <span className="text-slate-100 font-semibold truncate">{t.name}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border bg-amber-400/15 text-amber-300 border-amber-400/30 shrink-0">Brokerage</span>
      </div>
      <span className="block text-xs text-slate-500 mt-2 truncate">
        {t.states.length === 0 ? 'All states' : t.states.join(', ')}
        {` · ${docCategoryLabel(t.document_category ?? 'other') === 'Uncategorized' ? 'General' : docCategoryLabel(t.document_category ?? 'other')}`}
        {t.shared_by ? ` · from ${t.shared_by}` : ''}
      </span>
      {t.file_name && (
        <span className="mt-2 flex gap-3 text-xs">
          <button type="button" onClick={() => void openPdf(t, false)} className="text-blue-300 hover:text-blue-200">Preview</button>
          <button type="button" onClick={() => void openPdf(t, true)} className="text-blue-300 hover:text-blue-200">Download</button>
        </span>
      )}
    </div>
  );

  const customTile = (f: CustomFolder) => (
    <div key={`c-${f.id}`} className="flex items-stretch rounded-2xl border bg-white/5 border-white/10 hover:border-white/25 transition min-w-0">
      <button type="button" onClick={() => setFolder(`c:${f.id}`)} className="flex-1 min-w-0 text-left p-4">
        <span className="flex items-center gap-2 text-slate-100 font-semibold">
          <svg viewBox="0 0 20 20" className="w-5 h-5 text-amber-300 shrink-0" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h3.6a1 1 0 01.7.3L10 6h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span className="truncate">{f.name}</span>
        </span>
        <span className="block text-xs text-slate-400 mt-1">
          {f.items.length} thing{f.items.length === 1 ? '' : 's'}
        </span>
      </button>
      <div className="pr-2 pt-2">
        <Star on={isPinned('custom', f.id)} onClick={() => togglePin('custom', f.id)} label={isPinned('custom', f.id) ? 'Unpin folder' : 'Pin folder to the top'} />
      </div>
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

  // A link the person saved themselves for a state. Opens the page; never attached to a deal.
  const linkRow = (l: StateLink, showState = true) => (
    <div key={`link-${l.id}`} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl pl-4 pr-2 py-2.5 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-100 font-medium break-words">{showState && <span className="text-slate-400">{stateName(l.state)}: </span>}{l.label}</div>
        <div className="text-xs text-slate-500 truncate">{l.url}</div>
      </div>
      <a href={l.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-200 hover:text-blue-300 rounded-lg transition whitespace-nowrap">Open ↗</a>
      {removeBtn(() => void removeLink(l.id), 'Delete this link')}
    </div>
  );

  // Every state folder is the same size. Which states show on your home screen is chosen with "Choose states".
  const folderTile = (code: string) => {
    const n = count(code);
    return (
      <button key={`f-${code}`} type="button" onClick={() => setFolder(code)} className="text-left rounded-2xl border bg-white/5 border-white/10 hover:border-white/25 transition min-w-0 p-4">
        <span className="flex items-center gap-2 text-slate-100 font-semibold">
          <svg viewBox="0 0 20 20" className="w-5 h-5 text-blue-300 shrink-0" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h3.6a1 1 0 01.7.3L10 6h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span className="truncate">{folderName(code)}</span>
        </span>
        <span className="block text-xs text-slate-400 mt-1">
          {mode === 'pdfs' ? (n === 0 ? 'Empty · ready for PDFs' : `${n} PDF${n === 1 ? '' : 's'}`) : `${linkCount(code)} link${linkCount(code) === 1 ? '' : 's'}`}
        </span>
      </button>
    );
  };

  if (templates === null && !error) return <div className="text-slate-400">Loading…</div>;

  const query = q.trim().toLowerCase();
  const searchHits = query
    ? mode === 'pdfs'
      ? { templates: [...all, ...brokerageDocs].filter((t) => `${t.name} ${t.description ?? ''} ${t.file_name ?? ''}`.toLowerCase().includes(query)), trec: [] as TrecForm[], sources: [] as FormSource[], links: [] as StateLink[] }
      : {
          templates: [] as DocTemplate[],
          trec: trecForms.filter((f) => `${f.name} ${f.formId}`.toLowerCase().includes(query)),
          sources: US_STATES.flatMap((st) => formSourcesFor(st.code)).filter((x) => `${x.label} ${x.covers} ${stateName(x.state)}`.toLowerCase().includes(query)),
          links: links.filter((l) => `${l.label} ${l.url} ${stateName(l.state)}`.toLowerCase().includes(query)),
        }
    : null;

  const header = (
    <input className={inputCls} placeholder={mode === 'pdfs' ? 'Search your PDF templates' : 'Search state resources and links'} value={q} onChange={(e) => setQ(e.target.value)} aria-label={mode === 'pdfs' ? 'Search PDF templates' : 'Search state resources'} />
  );

  let body: React.ReactNode;
  if (searchHits) {
    body = (
      <div className="space-y-5">
        {searchHits.templates.length === 0 && searchHits.trec.length === 0 && searchHits.sources.length === 0 && searchHits.links.length === 0 && <p className="text-sm text-slate-400">Nothing matches “{q}”.</p>}
        {searchHits.links.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your links</h2>
            <div className="grid lg:grid-cols-2 gap-2">{searchHits.links.map((l) => linkRow(l))}</div>
          </section>
        )}
        {searchHits.templates.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">PDF templates</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{searchHits.templates.map((t) => templateCard(t))}</div>
          </section>
        )}
        {searchHits.trec.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Official TREC forms</h2>
            <div className="grid lg:grid-cols-2 gap-2">{searchHits.trec.map((f) => trecRow(f))}</div>
          </section>
        )}
        {searchHits.sources.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">State forms sources</h2>
            <div className="grid lg:grid-cols-2 gap-2">{searchHits.sources.map((x) => sourceRow(x, { showState: true }))}</div>
          </section>
        )}
      </div>
    );
  } else if (folder && customId(folder)) {
    const cf = folders.find((x) => x.id === customId(folder));
    const docs = cf ? cf.items.filter((i) => i.kind === 'template').map((i) => all.find((t) => t.id === i.ref)) : [];
    const forms = cf ? cf.items.filter((i) => i.kind === 'trec').map((i) => trecForms.find((x) => x.slug === i.ref)) : [];
    const sources = cf ? cf.items.filter((i) => i.kind === 'source').map((i) => findFormSource(i.ref)) : [];
    const shown = [...docs, ...forms, ...sources].filter(Boolean).length;
    const hidden = cf ? cf.items.length - shown : 0;
    body = !cf ? (
      <div className="space-y-3">
        <button type="button" onClick={() => setFolder(null)} className="text-sm text-slate-400 hover:text-slate-200">
          ← All folders
        </button>
        <p className="text-sm text-slate-400">That folder is gone.</p>
      </div>
    ) : (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => { setFolder(null); setRenaming(null); setConfirmDelete(false); }} className="text-sm text-slate-400 hover:text-slate-200">
            ← All folders
          </button>
          <div className="flex items-center gap-1 text-sm text-slate-300">
            {isPinned('custom', cf.id) ? 'Pinned to the top' : 'Pin this folder'}
            <Star on={isPinned('custom', cf.id)} onClick={() => togglePin('custom', cf.id)} label={isPinned('custom', cf.id) ? 'Unpin folder' : 'Pin folder to the top'} />
          </div>
        </div>
        {renaming !== null ? (
          <form className="flex flex-wrap gap-2 max-w-lg" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) renameFolder(cf, renaming.trim()); }}>
            <input className={inputCls} value={renaming} maxLength={60} autoFocus onChange={(e) => setRenaming(e.target.value)} aria-label="Folder name" />
            <button type="submit" className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm">Save</button>
            <button type="button" onClick={() => setRenaming(null)} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm">Cancel</button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold text-slate-100">{cf.name}</h2>
            <button type="button" onClick={() => setRenaming(cf.name)} className="text-sm text-blue-300 hover:text-blue-200">Rename</button>
            {confirmDelete ? (
              <span className="text-sm text-slate-300 flex items-center gap-2">
                Delete this folder? Your documents stay where they are.
                <button type="button" onClick={() => deleteFolder(cf)} className="px-2.5 py-1 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm">Delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="px-2.5 py-1 rounded-lg border border-slate-600 text-slate-300 text-sm">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-slate-400 hover:text-red-300">Delete folder</button>
            )}
          </div>
        )}
        {cf.items.length === 0 && (
          <p className="text-sm text-slate-400">
            Nothing here yet. Use the folder button on any document, Texas form or state source to add it. Folders only hold shortcuts, so nothing is copied or moved.
          </p>
        )}
        {docs.some(Boolean) && (
          <section>
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Your documents</h3>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{docs.filter((t): t is DocTemplate => !!t).map((t) => templateCard(t, () => toggleItem(cf, 'template', t.id)))}</div>
          </section>
        )}
        {forms.some(Boolean) && (
          <section>
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Official TREC forms</h3>
            <div className="grid lg:grid-cols-2 gap-2">{forms.filter((f): f is TrecForm => !!f).map((f) => trecRow(f, () => toggleItem(cf, 'trec', f.slug)))}</div>
          </section>
        )}
        {sources.some(Boolean) && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">State forms sources</h3>
            <div className="grid lg:grid-cols-2 gap-2">{sources.filter((x): x is FormSource => !!x).map((x) => sourceRow(x, { showState: true, remove: () => toggleItem(cf, 'source', x.id) }))}</div>
            {sourcesNote()}
          </section>
        )}
        {hidden > 0 && <p className="text-xs text-slate-500">{hidden} item{hidden === 1 ? ' is' : 's are'} not shown because the document is archived or the form is no longer listed.</p>}
      </div>
    );
  } else if (folder) {
    const mine = byFolder.get(folder) ?? [];
    const fromBrokerage = brokerageDocs.filter((t) => t.states.includes(folder));
    const stateInfo = STATE_FORM_INFO[folder];
    const stateSources = formSourcesFor(folder);
    const myLinks = links.filter((l) => l.state === folder);
    const grouped = (['contracts', 'addenda', 'other'] as const).map((sec) => ({ s: sec, rows: trecForms.filter((f) => f.section === sec) })).filter((g) => g.rows.length > 0);
    const byCategory = DOCUMENT_CATEGORIES.map((c) => ({ c, rows: mine.filter((t) => (t.document_category || 'other') === c.key) })).filter((g) => g.rows.length > 0);
    const knownKeys = new Set(DOCUMENT_CATEGORIES.map((c) => c.key));
    const stray = mine.filter((t) => !knownKeys.has(t.document_category || 'other'));
    body = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setFolder(null)} className="text-sm text-slate-400 hover:text-slate-200">
            ← All folders
          </button>
          <div className="flex items-center gap-1 text-sm text-slate-300">
            {isPinned('folder', folder) ? 'One of your states' : 'Add to your states'}
            <Star on={isPinned('folder', folder)} onClick={() => togglePin('folder', folder)} label={isPinned('folder', folder) ? 'Remove from your states' : 'Add to your states'} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-slate-100">{folderName(folder)}</h2>
          {mode === 'pdfs' && mine.length + fromBrokerage.length > 0 && (
            <button type="button" onClick={() => onUpload(folder)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition">Upload PDF to {stateName(folder)}</button>
          )}
        </div>

        {mode === 'pdfs' ? (
          <>
            {mine.length + fromBrokerage.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/20 bg-white/[0.03] p-8 text-center">
                <svg viewBox="0 0 20 20" className="w-10 h-10 text-blue-300/70 mx-auto mb-2" fill="currentColor" aria-hidden="true"><path d="M2 6a2 2 0 012-2h3.6a1 1 0 01.7.3L10 6h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                <p className="text-slate-100 font-semibold">{stateName(folder)} folder is ready</p>
                <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">No PDFs yet. Upload the {stateName(folder)} contracts and forms you use, and they will be organized here by category. Relay does not supply state contracts, so nothing is pre-filled.</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  <button type="button" onClick={() => onUpload(folder)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition">Upload PDF</button>
                  <button type="button" onClick={() => { setMode('resources'); setAddingLink(true); }} className="px-4 py-2 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl transition">Add a resource link</button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {fromBrokerage.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-200 mb-2">From your brokerage</h3>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{fromBrokerage.map((t) => brokerageCard(t))}</div>
                  </section>
                )}
                {byCategory.map((g) => (
                  <section key={g.c.key}>
                    <h3 className="text-sm font-semibold text-slate-200 mb-2">{g.c.label} <span className="text-slate-500 font-normal">({g.rows.length})</span></h3>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{g.rows.map((t) => templateCard(t))}</div>
                  </section>
                ))}
                {stray.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-200 mb-2">Other</h3>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{stray.map((t) => templateCard(t))}</div>
                  </section>
                )}
              </div>
            )}
            <button type="button" onClick={() => setMode('resources')} className="text-sm text-blue-300 hover:text-blue-200">Looking for official {stateName(folder)} forms pages? Open {stateName(folder)} resources →</button>
          </>
        ) : (
          <>
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

            {folder !== 'TX' && (
              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex flex-wrap items-center gap-2">
                    Official forms sources for {stateName(folder)}
                    {stateInfo && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                        <span className={`w-2 h-2 rounded-full ${TIER_DOT[stateInfo.tier]}`} />
                        {TIER_LABEL[stateInfo.tier]}
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-slate-300 mt-1">{stateInfo ? stateInfo.summary : 'We have not checked this one yet.'}</p>
                </div>
                {stateSources.length > 0 && <div className="grid lg:grid-cols-2 gap-2">{stateSources.map((x) => sourceRow(x))}</div>}
                {stateInfo && sourcesNote()}
              </section>
            )}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-200">Your {stateName(folder)} links</h3>
                {!addingLink && <button type="button" onClick={() => setAddingLink(true)} className="text-sm text-blue-300 hover:text-blue-200">+ Add a link</button>}
              </div>
              {addingLink && (
                <form className="grid sm:grid-cols-[1fr_1.4fr_auto_auto] gap-2" onSubmit={(e) => { e.preventDefault(); void saveLink(folder); }}>
                  <input className={inputCls} placeholder="Name, like “Association forms”" value={linkLabel} maxLength={140} onChange={(e) => setLinkLabel(e.target.value)} aria-label="Link name" />
                  <input className={inputCls} placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} aria-label="Link address" autoFocus />
                  <button type="submit" disabled={!linkUrl.trim()} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm">Save link</button>
                  <button type="button" onClick={() => { setAddingLink(false); setLinkLabel(''); setLinkUrl(''); }} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm">Cancel</button>
                </form>
              )}
              {myLinks.length > 0 ? (
                <div className="grid lg:grid-cols-2 gap-2">{myLinks.map((l) => linkRow(l, false))}</div>
              ) : (
                !addingLink && <p className="text-sm text-slate-400">No links of your own for {stateName(folder)}. Add the pages you check for forms, like your association’s members area.</p>
              )}
            </section>
            <button type="button" onClick={() => setMode('pdfs')} className="text-sm text-blue-300 hover:text-blue-200">Back to {stateName(folder)} PDF templates →</button>
          </>
        )}
      </div>
    );
  } else {
    const myStates = pins
      .filter((p) => p.kind === 'folder' && US_STATES.some((st) => st.code === p.ref))
      .map((p) => p.ref)
      .sort((a, b) => stateName(a).localeCompare(stateName(b)));
    const pinnedCustom = pins.filter((p) => p.kind === 'custom').map((p) => folders.find((f) => f.id === p.ref)).filter((f): f is CustomFolder => !!f);
    const pinnedSources = pins.filter((p) => p.kind === 'source').map((p) => findFormSource(p.ref)).filter((x): x is FormSource => !!x);
    const pinnedTemplates = all.filter((t) => isPinned('template', t.id));
    const pinnedTrec = trecForms.filter((f) => isPinned('trec', f.slug));
    const hasDisclosure = everything.some((t) => /iabs|brokerage services|agency disclosure|consumer notice/i.test(t.name));
    const general = all.filter((t) => t.states.length === 0);
    const statePicker = (
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">My states</h2>
          <button type="button" onClick={() => setPickStates((v) => !v)} className="text-sm text-blue-300 hover:text-blue-200">
            {pickStates ? 'Done' : 'Add states'}
          </button>
        </div>
        {pickStates && (
          <div className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-sm text-slate-300 mb-2">Tick the states you work in. Each one gets its own folder at the top, even before you have a PDF for it.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
              {US_STATES.map((st) => {
                const on = myStates.includes(st.code);
                return (
                  <button
                    key={st.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePin('folder', st.code)}
                    className={`flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg border text-sm transition ${on ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                  >
                    <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-500'}`}>{on ? '✓' : ''}</span>
                    <span className="truncate">{st.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {myStates.length === 0 ? (
          <p className="text-sm text-slate-400">{mode === 'pdfs' ? 'Add the states you work in. Each gets a folder that stays ready for the right PDFs, even while it is empty.' : 'Add the states you work in and they show up here, each with its official forms sources.'}</p>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{myStates.map((code) => folderTile(code))}</div>
        )}
      </section>
    );

    body = mode === 'resources' ? (
      <div className="space-y-7">
        <p className="text-sm text-slate-400 max-w-2xl">Links to each state’s own forms pages. They open on the source’s site, always the current version. They are links, not PDFs, so they are never added to a deal.</p>
        {(pinnedTrec.length > 0 || pinnedSources.length > 0) && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pinned</h2>
            <div className="grid lg:grid-cols-2 gap-2">
              {pinnedTrec.map((f) => trecRow(f))}
              {pinnedSources.map((x) => sourceRow(x, { showState: true }))}
            </div>
          </section>
        )}
        {statePicker}
        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">All states</h2>
          <p className="text-sm text-slate-400 mb-2">Open any state to see where its official forms are. The dot shows what each state itself publishes.</p>
          <p className="mb-2 text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TIER_DOT.contracts}`} />State publishes the contracts</span>
            <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TIER_DOT.disclosures}`} />State publishes some forms</span>
            <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TIER_DOT.association}`} />Contracts come from the REALTOR association</span>
            <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TIER_DOT.none}`} />No public source confirmed</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
            {US_STATES.map((st) => (
              <button
                key={st.code}
                type="button"
                onClick={() => setFolder(st.code)}
                title={`${st.name}${st.code === 'TX' ? ': official TREC forms' : STATE_FORM_INFO[st.code] ? `: ${TIER_LABEL[STATE_FORM_INFO[st.code].tier]}` : ''}`}
                className="flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-200 min-w-0"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${st.code === 'TX' ? 'bg-emerald-400' : STATE_FORM_INFO[st.code] ? TIER_DOT[STATE_FORM_INFO[st.code].tier] : 'bg-slate-700'}`} />
                <span className="truncate">{st.name}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    ) : (
      <div className="space-y-7">
        {brokerageDocs.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">From your brokerage</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{brokerageDocs.map((t) => brokerageCard(t))}</div>
            <p className="text-xs text-slate-500 mt-2">Use these from any deal. Only your brokerage can change them.</p>
          </section>
        )}

        {(pinnedCustom.length > 0 || pinnedTemplates.length > 0) && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pinned</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {pinnedCustom.map((f) => customTile(f))}
              {pinnedTemplates.map((t) => templateCard(t))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Recently used</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{recent.map((t) => templateCard(t))}</div>
          </section>
        )}

        {statePicker}

        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">General PDFs (every state)</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {general.map((t) => templateCard(t))}
            {!hasDisclosure && (
              <button type="button" onClick={() => onUpload(null)} className="text-left rounded-2xl border border-dashed border-white/25 hover:border-blue-400 bg-white/[0.02] p-4 transition min-w-0">
                <span className="block text-slate-100 font-semibold">+ Add a brokerage’s IABS</span>
                <span className="block text-xs text-slate-400 mt-1">You work with agents from different brokerages. Upload each brokerage’s disclosure (like an Information About Brokerage Services form) once, named for it, e.g. “Acme Realty IABS”. Relay offers the matching one on that agent’s deals.</span>
              </button>
            )}
            {all.length === 0 && (
              <button type="button" onClick={() => onUpload(null)} className="text-left rounded-2xl border border-dashed border-white/25 hover:border-blue-400 bg-white/[0.02] p-4 transition min-w-0">
                <span className="block text-slate-100 font-semibold">+ Upload PDFs</span>
                <span className="block text-xs text-slate-400 mt-1">Your own PDF forms, kept here and organized by state and category.</span>
              </button>
            )}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">My folders</h2>
            {!creating && (
              <button type="button" onClick={() => { setCreating(true); setNewName(''); }} className="text-sm text-blue-300 hover:text-blue-200">
                + New folder
              </button>
            )}
          </div>
          {creating && (
            <form
              className="flex flex-wrap gap-2 max-w-lg mb-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) return;
                const f = await makeFolder(name);
                if (f) {
                  setCreating(false);
                  setNewName('');
                  setFolder(`c:${f.id}`);
                }
              }}
            >
              <input className={inputCls} placeholder="Folder name, like “New listing packet”" value={newName} maxLength={60} autoFocus onChange={(e) => setNewName(e.target.value)} aria-label="New folder name" />
              <button type="submit" className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm">Make folder</button>
              <button type="button" onClick={() => setCreating(false)} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm">Cancel</button>
            </form>
          )}
          {folders.length === 0 && !creating ? (
            <p className="text-sm text-slate-400">Make a folder for the PDFs you use all the time, like everything for a new listing. Folders only hold shortcuts, so nothing is copied or moved.</p>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{folders.filter((f) => !pins.some((p) => p.kind === 'custom' && p.ref === f.id)).map((f) => customTile(f))}</div>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">All states</h2>
          <p className="text-sm text-slate-400 mb-2">Every state has a folder, empty or not. Open one to see its PDFs by category.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
            {US_STATES.map((st) => {
              const n = count(st.code);
              return (
                <button key={st.code} type="button" onClick={() => setFolder(st.code)} className="flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-200 min-w-0">
                  <span className="truncate">{st.name}</span>
                  {n > 0 && <span className="shrink-0 text-xs text-blue-300">{n}</span>}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}
      {fileNote && <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">{fileNote}</div>}
      <div className="inline-flex p-1 bg-white/5 border border-white/10 rounded-xl" role="tablist" aria-label="Library">
        {([['pdfs', 'PDF Templates'], ['resources', 'State Resources']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setQ(''); setAddingLink(false); }} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${mode === id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
            {label}
          </button>
        ))}
      </div>
      {header}
      {body}
    </div>
  );
}
