'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface Step {
  key: number;
  name: string;
  offsetDays: number;
}

const inputCls =
  'bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

let counter = 0;
const nextKey = () => ++counter;

export default function ListingTemplatePage() {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>([]);
  const [isCustom, setIsCustom] = useState(false);
  const [name, setName] = useState('Standard');
  const [names, setNames] = useState<string[]>(['Standard']);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  const load = useCallback(async (which: string = 'Standard') => {
    try {
      const res = await authFetch(`/api/listing-template?name=${encodeURIComponent(which)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setSteps((data.steps as { name: string; offsetDays: number }[]).map((s) => ({ key: nextKey(), name: s.name, offsetDays: s.offsetDays })));
      setIsCustom(Boolean(data.isCustom));
      setName(data.name || which);
      setNames(Array.isArray(data.names) ? data.names : ['Standard']);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    const t = setTimeout(() => load('Standard'), 0);
    return () => clearTimeout(t);
  }, [load]);

  const update = (key: number, patch: Partial<Step>) => setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (index: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const save = async () => {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const res = await authFetch('/api/listing-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, steps: steps.map((s) => ({ name: s.name, offsetDays: s.offsetDays })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setIsCustom(true);
      setNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setNotice(`Saved. Pick “${name}” when you create a listing to start with this checklist.`);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const isStandard = name === 'Standard';
    if (!confirm(isStandard ? 'Go back to Relay’s starter checklist? Your saved version will be removed.' : `Delete the “${name}” checklist? Listings already made from it are not changed.`)) return;
    try {
      await authFetch(`/api/listing-template?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      setLoading(true);
      await load(isStandard ? 'Standard' : 'Standard');
      setNotice(isStandard ? 'Back to the starter checklist.' : 'Checklist deleted.');
    } catch (err) {
      if (!handleAuth(err)) setError('Failed to reset');
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <Link href="/dashboard/listings" className="text-sm text-slate-400 hover:text-slate-200">
        ← Back to listings
      </Link>
      <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mt-3 mb-1">Listing checklists</h1>
      <p className="text-slate-400 mb-6">
        A new listing starts with the checklist you pick for it (Standard unless you choose another). Days are counted from the planned list date: <span className="text-slate-300">-7</span> is a week before going live,{' '}
        <span className="text-slate-300">0</span> is list day, <span className="text-slate-300">14</span> is two weeks after. {isCustom ? 'This is your own version.' : 'This is Relay’s starter set; edit it to match how you work.'}
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider" htmlFor="tmpl-name">
          Checklist
        </label>
        <select
          id="tmpl-name"
          value={name}
          onChange={(e) => {
            setNotice('');
            setLoading(true);
            load(e.target.value);
          }}
          className={inputCls}
        >
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input className={`${inputCls} w-44`} placeholder="New checklist name" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New checklist name" />
        <button
          type="button"
          disabled={!newName.trim() || names.length >= 10}
          onClick={() => {
            const n = newName.replace(/\s+/g, ' ').trim().slice(0, 40);
            if (!n) return;
            // Starts as a copy of what is on screen; nothing is saved until "Save checklist".
            setName(n);
            setNames((prev) => (prev.includes(n) ? prev : [...prev, n]));
            setIsCustom(false);
            setNewName('');
            setNotice(`New checklist “${n}” started from the steps below. Edit them, then save.`);
          }}
          className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-40"
        >
          Start new checklist
        </button>
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <input className={`${inputCls} flex-1 min-w-0`} value={s.name} maxLength={200} onChange={(e) => update(s.key, { name: e.target.value })} aria-label={`Step ${i + 1} name`} />
            <input
              className={`${inputCls} w-20`}
              type="number"
              value={s.offsetDays}
              onChange={(e) => update(s.key, { offsetDays: Math.round(Number(e.target.value) || 0) })}
              aria-label="Days from list date"
              title="Days from the list date (negative = before)"
            />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-200 disabled:opacity-30 px-1" aria-label="Move up">
              ↑
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="text-slate-400 hover:text-slate-200 disabled:opacity-30 px-1" aria-label="Move down">
              ↓
            </button>
            <button type="button" onClick={() => setSteps((prev) => prev.filter((x) => x.key !== s.key))} className="text-slate-500 hover:text-red-300 px-1" aria-label="Remove step">
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setSteps((prev) => [...prev, { key: nextKey(), name: '', offsetDays: 0 }])}
        className="mt-3 text-sm text-blue-400 hover:text-blue-300"
      >
        + Add a step
      </button>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-4 text-sm text-green-400">{notice}</p>}

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || steps.length === 0 || steps.some((s) => !s.name.trim())}
          className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save checklist'}
        </button>
        {isCustom && (
          <button type="button" onClick={reset} className="text-sm text-slate-400 hover:text-slate-200">
            Reset to starter
          </button>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-500">Changes only affect listings you create afterward. Listings already started keep their own steps.</p>
    </div>
  );
}
