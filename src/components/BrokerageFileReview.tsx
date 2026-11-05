'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { DOCUMENT_CATEGORIES } from '@/lib/documentTaxonomy';

// File review for a brokerage owner (Collaborate → File review): choose which documents every file must contain, then go
// through closed files (and files about to close), see what is missing, and mark each reviewed or flag it for the agent.
// The review is the owner's own record; it never changes the agent's deal.

interface FileRow {
  id: string;
  address: string | null;
  fileNumber: string | null;
  agentName: string;
  closed: boolean;
  closingDate: string | null;
  missing: string[];
  review: { status: 'reviewed' | 'flagged'; note: string | null; reviewedAt: string } | null;
}
interface Data { required: string[]; files: FileRow[]; totals: { listed: number; needsReview: number; flagged: number; reviewed: number } }

const card = 'bg-white/5 border border-white/10 rounded-2xl';
const date = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No closing date');

export default function BrokerageFileReview() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [flagging, setFlagging] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');

  const load = useCallback(async () => {
    const res = await authFetch('/api/oversight/file-review');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load file review');
    setData(body);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load file review'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const saveRequired = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await authFetch('/api/oversight/file-review/requirements', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: draft }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const review = async (id: string, status: 'reviewed' | 'flagged' | 'clear', text = '') => {
    setBusy(id);
    setError('');
    try {
      const res = await authFetch(`/api/oversight/file-review/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note: text }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      setFlagging(null);
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy('');
    }
  };

  if (!data) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;

  const shown = data.files.filter((f) => filter === 'all' || !f.review || f.review.status === 'flagged');

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-slate-100 font-semibold">Required documents</p>
            <p className="text-sm text-slate-400 mt-0.5">
              {data.required.length === 0 ? 'Choose the documents every file must contain. Files missing any of them are marked below.' : `${data.required.length} required: ${data.required.join(', ')}.`}
            </p>
          </div>
          <button type="button" onClick={() => { setDraft(data.required); setEditing((v) => !v); }} className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-xs font-semibold rounded-lg transition">
            {editing ? 'Close' : data.required.length === 0 ? 'Choose documents' : 'Change'}
          </button>
        </div>
        {editing && (
          <div className="mt-4 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {DOCUMENT_CATEGORIES.filter((c) => c.key !== 'other').map((c) => (
                <fieldset key={c.key}>
                  <legend className="text-xs uppercase tracking-wider text-slate-500 mb-1">{c.label}</legend>
                  {c.types.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm text-slate-300 py-0.5">
                      <input type="checkbox" checked={draft.includes(t)} onChange={(e) => setDraft((d) => (e.target.checked ? [...d, t] : d.filter((x) => x !== t)))} />
                      {t}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <button type="button" disabled={saving} onClick={saveRequired} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Need review', value: data.totals.needsReview, tone: data.totals.needsReview > 0 ? 'text-amber-300' : '' },
          { label: 'Flagged', value: data.totals.flagged, tone: data.totals.flagged > 0 ? 'text-red-300' : '' },
          { label: 'Reviewed', value: data.totals.reviewed, tone: data.totals.reviewed > 0 ? 'text-emerald-300' : '' },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{s.label}</p>
            <p className={`text-2xl font-semibold mt-0.5 ${s.tone || 'text-slate-100'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 text-sm">
        {(['todo', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={`px-3 py-1.5 rounded-lg border transition ${filter === f ? 'border-blue-400 text-blue-300' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}>
            {f === 'todo' ? 'To do' : 'All files'}
          </button>
        ))}
      </div>

      {data.files.length === 0 ? (
        <p className={`${card} border-dashed p-8 text-center text-sm text-slate-400`}>No closed files from the last 180 days, and nothing closing in the next 30 days.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing left to review.</p>
      ) : (
        <ul className={`${card} divide-y divide-white/5`} aria-label="Files to review">
          {shown.map((f) => (
            <li key={f.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/dashboard/collaborate/deals/${f.id}`} className="text-sm font-semibold text-slate-100 hover:text-blue-300">{f.address ?? 'Untitled deal'}</Link>
                  <p className="text-xs text-slate-500">{f.agentName} · {f.closed ? 'Closed' : 'Closing'} {date(f.closingDate)}{f.fileNumber ? ` · File ${f.fileNumber}` : ''}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {data.required.length > 0 && f.missing.length === 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">All required documents</span>}
                    {f.missing.map((m) => <span key={m} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">Missing: {m}</span>)}
                    {f.review?.status === 'reviewed' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">Reviewed {date(f.review.reviewedAt)}</span>}
                    {f.review?.status === 'flagged' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/30">Flagged {date(f.review.reviewedAt)}</span>}
                  </div>
                  {f.review?.note && <p className="text-xs text-slate-400 mt-1.5">Note: {f.review.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.review ? (
                    <button type="button" disabled={busy === f.id} onClick={() => review(f.id, 'clear')} className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-300 text-xs font-semibold rounded-lg transition">Undo</button>
                  ) : (
                    <button type="button" disabled={busy === f.id} onClick={() => review(f.id, 'reviewed')} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition">Mark reviewed</button>
                  )}
                  {f.review?.status !== 'flagged' && (
                    <button type="button" onClick={() => { setFlagging(flagging === f.id ? null : f.id); setNote(''); }} className="px-3 py-1.5 border border-slate-600 hover:border-amber-400 text-slate-300 hover:text-amber-300 text-xs font-semibold rounded-lg transition">Flag</button>
                  )}
                </div>
              </div>
              {flagging === f.id && (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What does the agent need to fix? (optional)" aria-label="Note for the agent" className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500" />
                  <button type="button" disabled={busy === f.id} onClick={() => review(f.id, 'flagged', note)} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 text-sm font-semibold rounded-lg transition">Flag and tell the agent</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
