'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { sayFor } from '@/components/BrokerageAutomations';
import { MAX_REQUIRED_STEPS, STEP_NAME_MAX, type RequiredStep, type StepKind } from '@/lib/brokerageRequiredStepsRules';

// The checklist the broker sets once for every agent: required steps for transactions and for listings. New files get the missing steps
// when they are created, and "Add to files already open" does the same for files in progress. A step an agent already has is not added twice.

const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';
const input = 'bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100';
const COPY: Record<StepKind, { title: string; blurb: string; due: string; example: string }> = {
  transaction: { title: 'Required steps for transactions', blurb: 'Added to every agent’s deals as they are created.', due: 'days after acceptance', example: 'e.g. Broker file review' },
  listing: { title: 'Required steps for listings', blurb: 'Added to every agent’s listings as they are created.', due: 'days from the planned list date', example: 'e.g. Listing agreement signed' },
};

// Days are shown in words ("7 days before listing"), never as a minus sign. A listing step is stored as a negative number when it falls before the list date.
interface Row { name: string; n: string; dir: 'before' | 'after' }
const toRow = (s: RequiredStep): Row => ({ name: s.name, n: s.dueDays === null ? '' : String(Math.abs(s.dueDays)), dir: s.dueDays !== null && s.dueDays < 0 ? 'before' : 'after' });
const toStep = (r: Row, kind: StepKind): RequiredStep => {
  const n = r.n.trim() === '' ? null : Math.max(0, Number(r.n) || 0);
  return { name: r.name, dueDays: n === null ? null : kind === 'listing' && r.dir === 'before' ? -n : n };
};
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
export function describeDue(kind: StepKind, days: number | null): string {
  if (days === null) return 'No due date';
  if (kind === 'transaction') return days === 0 ? 'Due on acceptance' : `${plural(days)} after acceptance`;
  return days === 0 ? 'On the list date' : days < 0 ? `${plural(-days)} before listing` : `${plural(days)} after listing`;
}

function Editor({ kind, saved, onSaved, canEdit, team }: { kind: StepKind; saved: RequiredStep[]; onSaved: (note: string) => Promise<void>; canEdit: boolean; team: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => saved.map(toRow));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const steps = rows.filter((r) => r.name.trim()).map((r) => toStep(r, kind));
  const changed = JSON.stringify(steps) !== JSON.stringify(saved);
  const c = COPY[kind];
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) => setRows((r) => { const j = i + by; if (j < 0 || j >= r.length) return r; const n = [...r]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const cancel = () => { setRows(saved.map(toRow)); setEditing(false); setError(''); };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch('/api/oversight/required-steps', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, steps }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save');
      setRows((body.steps as RequiredStep[]).map(toRow));
      setEditing(false);
      await onSaved(`${c.title} saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-slate-100 font-semibold">{c.title}</p>
          <p className="text-sm text-slate-400 mt-0.5 mb-3">{team ? c.blurb.replace('every agent’s', 'every coordinator’s') : c.blurb} {team ? 'Default for your whole team.' : 'Default for all agents.'}</p>
        </div>
        {canEdit && !editing && <button type="button" onClick={() => setEditing(true)} className="shrink-0 px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">Edit</button>}
      </div>

      {!editing ? (
        saved.length === 0 ? <p className="text-sm text-slate-500">No required steps yet.</p> : (
          <ol className="divide-y divide-white/5">
            {saved.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <span className="text-slate-200"><span className="text-slate-500 mr-2">{i + 1}.</span>{s.name}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">{describeDue(kind, s.dueDays)}</span>
              </li>
            ))}
          </ol>
        )
      ) : (
        <>
          {rows.length === 0 && <p className="text-sm text-slate-500 mb-3">No required steps yet.</p>}
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input aria-label="Step" value={r.name} maxLength={STEP_NAME_MAX} onChange={(e) => set(i, { name: e.target.value })} placeholder={c.example} className={`${input} flex-1 min-w-[12rem]`} />
                <input aria-label="Days" type="number" min={0} max={365} value={r.n} onChange={(e) => set(i, { n: e.target.value })} placeholder="Days" className={`${input} w-20`} />
                {kind === 'listing' ? (
                  <select aria-label="Before or after the list date" value={r.dir} onChange={(e) => set(i, { dir: e.target.value as Row['dir'] })} className={input}>
                    <option value="before">days before listing</option>
                    <option value="after">days after listing</option>
                  </select>
                ) : <span className="text-xs text-slate-500">days after acceptance</span>}
                <span className="flex gap-1 text-xs">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="px-1.5 py-1 text-slate-400 hover:text-slate-100 disabled:opacity-30">↑</button>
                  <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="px-1.5 py-1 text-slate-400 hover:text-slate-100 disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="px-1.5 py-1 text-slate-500 hover:text-red-300">Remove</button>
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
          <div className="flex flex-wrap gap-3 mt-4">
            <button type="button" disabled={rows.length >= MAX_REQUIRED_STEPS} onClick={() => setRows((r) => [...r, { name: '', n: '', dir: 'before' }])} className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition disabled:opacity-40">+ Add a step</button>
            <button type="button" disabled={busy || !changed} onClick={save} className="px-4 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition">{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" disabled={busy} onClick={cancel} className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-sm">Cancel</button>
          </div>
        </>
      )}
      {!editing && error && <p className="text-sm text-red-300 mt-2">{error}</p>}
    </div>
  );
}

export default function BrokerageRequiredSteps({ canEdit, team = false }: { canEdit: boolean; team?: boolean }) {
  const say = sayFor(team ? 'team' : 'brokerage');
  const [data, setData] = useState<Record<StepKind, RequiredStep[]> | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    const res = await authFetch('/api/oversight/required-steps');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load the required steps');
    setData(body);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load the required steps')); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const apply = async () => {
    setApplying(true);
    setError('');
    try {
      const res = await authFetch('/api/oversight/required-steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not add the steps');
      setNote(body.steps === 0 ? 'Every open file already has these steps.' : `Added ${body.steps} step${body.steps === 1 ? '' : 's'} to ${body.deals} deal${body.deals === 1 ? '' : 's'} and ${body.listings} listing${body.listings === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the steps');
    } finally {
      setApplying(false);
    }
  };

  if (!data) return error ? <p className="text-sm text-red-300">{error}</p> : <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-slate-100 font-semibold">Required steps</h2>
        <p className="text-sm text-slate-400 max-w-2xl">{team ? 'Set the checklist everyone on your team works from, including you. Steps are added to new files automatically. Coordinators keep their own steps and can still add more.' : say('Set the checklist every agent works from. Steps are added to new files automatically. Agents keep their own steps and can still add more.')}</p>
      </div>
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
      {note && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">{note}</p>}
      <div className="grid lg:grid-cols-2 gap-5">
        <Editor team={team} kind="transaction" saved={data.transaction} onSaved={async (n) => { setNote(n); await load(); }} canEdit={canEdit} />
        <Editor team={team} kind="listing" saved={data.listing} onSaved={async (n) => { setNote(n); await load(); }} canEdit={canEdit} />
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={applying} onClick={apply} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition disabled:opacity-50">{applying ? 'Adding…' : 'Add to files already open'}</button>
          <span className="text-xs text-slate-500">Save first. Adds the steps open deals and listings are missing; nothing is added twice.</span>
        </div>
      )}
    </div>
  );
}
