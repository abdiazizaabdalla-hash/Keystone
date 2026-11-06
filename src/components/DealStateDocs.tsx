'use client';

import { useEffect, useState, type DragEvent } from 'react';
import { useAgentAccess } from '@/lib/useAgentAccess';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { US_STATES } from '@/lib/usStates';
import { addTemplatesToDeal, summarizeAdded } from '@/lib/addTemplatesClient';
import LibraryPicker from '@/components/LibraryPicker';

// The documents for the state the property is in (from its address, or the state chosen on the Overview tab). Shows only PDFs:
// the person's own PDF templates and letters for that state, and a way to browse the whole library. Links to a state's official
// forms are not PDFs, so they live in one place: the state's folder under Templates > State Resources, linked from here.

export interface DealTemplate {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  states: string[];
  from_brokerage?: boolean;
}

const IABS_RE = /iabs|information about brokerage|agency disclosure|consumer notice/i;
const box = 'bg-white/5 border border-white/10 rounded-2xl p-5';
const card = 'bg-slate-800/40 border border-white/10 rounded-xl p-3';

const OPEN_KEY = 'relay.stateDocsOpen';

export default function DealStateDocs({ transactionId, dealState, onAdded, onDropFiles }: { transactionId: string; dealState: string | null; onAdded: () => void; onDropFiles?: (files: FileList) => void }) {
  const [mine, setMine] = useState<DealTemplate[] | null>(null);
  // The folder remembers whether you left it open. Closed by default so the page stays quiet.
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try { setOpen(window.localStorage.getItem(OPEN_KEY) === '1'); } catch { /* storage is optional */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggle = () => {
    setOpen((v) => {
      try { window.localStorage.setItem(OPEN_KEY, v ? '0' : '1'); } catch { /* storage is optional */ }
      return !v;
    });
  };
  const [picking, setPicking] = useState(false);
  const { readOnly } = useAgentAccess();

  useEffect(() => {
    if (!dealState) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/templates?kinds=letter,form&state=${dealState}`);
        if (cancelled) return;
        setMine(res.ok ? ((await res.json()) as DealTemplate[]) : []);
      } catch {
        if (!cancelled) setMine([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealState]);

  if (!dealState) {
    return (
      <section className={box}>
        <h2 className="text-lg font-bold text-slate-100 mb-1">Documents for this deal&rsquo;s state</h2>
        <p className="text-sm text-slate-400">Add the property address, or choose the state on the Overview tab, to see the forms and templates for that state here.</p>
      </section>
    );
  }

  const stateName = US_STATES.find((s) => s.code === dealState)?.name ?? dealState;
  const stateOnly = (mine ?? []).filter((t) => t.states.includes(dealState));
  const allState = (mine ?? []).filter((t) => t.states.length === 0);
  const hasIabs = (mine ?? []).some((t) => t.kind === 'form' && IABS_RE.test(t.name));

  // Choosing a letter or form puts it straight into this deal's Documents, filled in with the deal's details. No pop-up to click through.
  const add = async (list: DealTemplate[], all: boolean) => {
    if (adding || list.length === 0) return;
    setAdding(true);
    setNote(null);
    try {
      const result = await addTemplatesToDeal(transactionId, list.map((t) => t.id), all);
      setNote({ text: summarizeAdded(result), bad: result.added.length === 0 });
      if (result.added.length > 0) onAdded();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'Could not add that to this deal', bad: true });
    } finally {
      setAdding(false);
    }
  };

  const chip = (t: DealTemplate) => (
    <button
      key={t.id}
      type="button"
      disabled={adding}
      onClick={() => void add([t], false)}
      className="max-w-full inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-sm text-slate-100 transition"
      title={t.description || `Add “${t.name}” to this deal`}
    >
      <span className="truncate">{t.name}</span>
      <span className="text-[10px] uppercase tracking-wide text-blue-300 shrink-0">{t.kind === 'form' ? 'Form' : 'Letter'}</span>
      {t.from_brokerage && <span className="text-[10px] uppercase tracking-wide text-amber-300 shrink-0">Brokerage</span>}
    </button>
  );

  const yours = stateOnly.length + allState.length;
  const everything = [...stateOnly, ...allState];
  const isFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <section
      className={`${box} ${over ? 'ring-2 ring-blue-400/70' : ''}`}
      onDragOver={onDropFiles ? (e) => { if (!isFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!over) setOver(true); } : undefined}
      onDragLeave={onDropFiles ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); } : undefined}
      onDrop={onDropFiles ? (e) => { setOver(false); if (!isFile(e)) return; e.preventDefault(); onDropFiles(e.dataTransfer.files); } : undefined}
    >
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full flex items-center gap-3 text-left">
        <svg className="w-6 h-6 text-amber-300 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="flex-1 min-w-0">
          <span className="block text-lg font-bold text-slate-100">{stateName} documents for this deal</span>
          <span className="block text-xs text-slate-500">
            {mine === null ? 'Loading…' : `${yours} PDF${yours === 1 ? '' : 's'} in your library`}
            {onDropFiles ? ' · drop files here to add them to this deal' : ''}
          </span>
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
      <div className="space-y-3 mt-3">
      <p className="text-xs text-slate-500">Chosen from the property address ({dealState}). You can change the state on the Overview tab.</p>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-slate-100">Your {stateName} PDFs</p>
          {!readOnly && <button type="button" onClick={() => setPicking(true)} className="px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-200 hover:text-blue-300 text-xs font-semibold rounded-lg transition">Add from Library</button>}
          {everything.length > 0 && !readOnly && (
            <button type="button" disabled={adding} onClick={() => void add(everything, true)} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition" title="Add every PDF below to this deal's Documents, filled in. Ones already there are left alone.">
              {adding ? 'Adding…' : `Add all ${everything.length} to this deal`}
            </button>
          )}
        </div>
        {note && <p className={`text-xs mb-2 rounded-lg px-3 py-2 border ${note.bad ? 'text-amber-200 bg-amber-500/10 border-amber-500/30' : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'}`} role="status">{note.text}</p>}
        {everything.length > 0 && <p className="text-xs text-slate-500 mb-2">Click one to add it to this deal, filled in with the deal&rsquo;s details.</p>}
        {mine === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : stateOnly.length === 0 ? (
          <p className="text-sm text-slate-400">
            No {stateName} PDFs in your library yet. The folder is ready for the right ones. <Link href={`/dashboard/templates?upload=pdf&state=${dealState}`} className="text-blue-400 hover:text-blue-300">Upload a PDF</Link>.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">{stateOnly.map(chip)}</div>
        )}
        {allState.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1.5">For every state</p>
            <div className="flex flex-wrap gap-2">{allState.map(chip)}</div>
          </div>
        )}
        {!hasIabs && (
          <Link
            href={`/dashboard/templates?upload=pdf&state=${dealState}`}
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-600 hover:border-blue-500 px-3 py-2.5 text-sm text-slate-300 hover:text-blue-300 transition"
          >
            <span>
              Add your brokerage&rsquo;s IABS{dealState === 'TX' ? ' (Information About Brokerage Services)' : ' or agency disclosure'}
              <span className="block text-xs text-slate-500">Upload once, use on every {stateName} deal</span>
            </span>
          </Link>
        )}
      </div>

      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100">{stateName} resources</p>
          <p className="text-xs text-slate-400">Official forms pages and links for {stateName}. They open on the source&rsquo;s own site; they are links, not PDFs, so they are never added to a deal.</p>
        </div>
        <Link href={`/dashboard/templates?tab=library&view=resources&state=${dealState}`} className="shrink-0 px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-200 hover:text-blue-300 text-sm font-semibold rounded-lg transition">
          Open {stateName} resources →
        </Link>
      </div>
      </div>
      )}
      {picking && (
        <LibraryPicker
          target={{ kind: 'deal', id: transactionId }}
          dealState={dealState}
          onClose={() => setPicking(false)}
          onAdded={(text) => { setNote({ text, bad: false }); onAdded(); }}
        />
      )}
    </section>
  );
}
