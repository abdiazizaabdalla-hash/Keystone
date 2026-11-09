'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { TRIGGERS, type Category, type Step } from '@/lib/automation/library';
import AutomationBuilder, { blankAutomation, type BuilderValue } from '@/components/AutomationBuilder';
import { summarizeSteps } from '@/components/ApplyAutomations';
import PresetLibrary from '@/components/PresetLibrary';
import type { Preset } from '@/lib/automation/presets';

interface Template {
  id: string;
  name: string;
  description: string;
  category: Category;
  trigger_type: string;
  steps: Step[];
  active: boolean;
  version: number;
  dealCount: number;
  outdatedCount: number;
  stats: { ok: number; failed: number; pending: number };
}
interface Run { id: string; label: string; summary: string; status: string; reason: string; createdAt: string; executedAt: string | null }

const STATUS: Record<string, [string, string]> = {
  executed: ['Done', 'text-emerald-300'], awaiting_approval: ['Needs your OK', 'text-amber-300'], deferred: ['Waiting', 'text-sky-300'],
  failed: ['Failed', 'text-red-300'], refused: ['Not done', 'text-red-300'], cancelled: ['Cancelled', 'text-slate-400'], approved: ['Running', 'text-sky-300'], proposed: ['Pending', 'text-sky-300'],
};

async function errorOf(res: Response, fallback: string) {
  return (await res.json().catch(() => ({}))).error || fallback;
}

export default function AutomationsPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; value: BuilderValue } | null>(null);
  const [saving, setSaving] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([authFetch('/api/automation/templates'), authFetch(`/api/automation/history${historyFor ? `?templateId=${historyFor}` : ''}`)]);
      if (!t.ok) throw new Error(await errorOf(t, 'Could not load your automations'));
      setTemplates((await t.json()).templates);
      if (h.ok) setRuns((await h.json()).runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your automations');
    }
  }, [historyFor]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!isFeatureOnClient('automation')) return <div className="p-4 md:p-8 text-slate-400">Automations are not available yet.</div>;

  const act = async (fn: () => Promise<Response>, fallback: string, done?: (body: Record<string, unknown>) => string | null) => {
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(await errorOf(res, fallback));
      const body = await res.json().catch(() => ({}));
      if (done) setNotice(done(body));
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    }
  };
  const json = { 'Content-Type': 'application/json' };

  const save = async (v: BuilderValue) => {
    setSaving(true);
    setBuilderError(null);
    try {
      const res = await authFetch(editing?.id ? `/api/automation/templates/${editing.id}` : '/api/automation/templates', { method: editing?.id ? 'PUT' : 'POST', headers: json, body: JSON.stringify(v) });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not save'));
      setEditing(null);
      setNotice(editing?.id ? 'Saved. Deals already using it keep their own copy until you choose Update deals.' : 'Saved. You can now apply it when you create a transaction or listing, or from a deal Automation tab.');
      await load();
    } catch (e) {
      setBuilderError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const presetValue = (p: Preset): BuilderValue => ({ name: p.name, description: p.summary, category: p.category, triggerType: p.triggerType, steps: p.steps.map((x) => ({ ...x })) });
  const addPreset = async (p: Preset) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/automation/templates', { method: 'POST', headers: json, body: JSON.stringify(presetValue(p)) });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not add it'));
      setError(null);
      setNotice(`Added "${p.name}" to your list below. Apply it when you create a transaction or listing, or from a deal's Automation tab.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add it');
    } finally {
      setSaving(false);
    }
  };

  const section = (category: Category, title: string, blurb: string) => {
    const list = (templates ?? []).filter((t) => t.category === category);
    return (
      <section className="space-y-3" data-testid={`automations-${category}`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="text-sm text-slate-400">{blurb}</p>
          </div>
          <button type="button" onClick={() => { setBuilderError(null); setEditing({ id: null, value: blankAutomation(category) }); }} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-400" data-testid={`create-${category}`}>Create {category} automation</button>
        </div>
        {templates === null ? <p className="text-sm text-slate-500">Loading…</p> : list.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-400">No {category} automations yet.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((t) => (
              <article key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-4" data-testid="automation-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{t.name}</h3>
                    {t.description && <p className="text-xs text-slate-400">{t.description}</p>}
                  </div>
                  <button type="button" role="switch" aria-checked={t.active} aria-label={`${t.name} is ${t.active ? 'on' : 'off'}`} onClick={() => void act(() => authFetch(`/api/automation/templates/${t.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ active: !t.active }) }), 'Could not switch it', () => (t.active ? 'Switched off. Its copies on deals are paused and anything they had queued was cancelled.' : 'Switched on.'))}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${t.active ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-slate-300'}`}>{t.active ? 'Active' : 'Inactive'}</button>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300">
                  <dt className="text-slate-500">Trigger</dt><dd>{TRIGGERS.find((x) => x.id === t.trigger_type)?.label ?? t.trigger_type}</dd>
                  <dt className="text-slate-500">Steps</dt><dd>{t.steps.length}: {summarizeSteps(t.steps)}</dd>
                  <dt className="text-slate-500">Used on</dt><dd>{t.dealCount} {category === 'transaction' ? (t.dealCount === 1 ? 'transaction' : 'transactions') : (t.dealCount === 1 ? 'listing' : 'listings')}</dd>
                  <dt className="text-slate-500">Runs</dt><dd><span className="text-emerald-300">{t.stats.ok} done</span> · <span className="text-red-300">{t.stats.failed} failed</span> · <span className="text-amber-300">{t.stats.pending} pending</span></dd>
                </dl>
                {t.outdatedCount > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">
                    {t.outdatedCount} {t.outdatedCount === 1 ? 'file is' : 'files are'} still on an older version.{' '}
                    <button type="button" className="underline" onClick={() => void act(() => authFetch(`/api/automation/templates/${t.id}/update-copies`, { method: 'POST' }), 'Could not update', (b) => `Updated ${b.updated} ${b.updated === 1 ? 'file' : 'files'}.`)}>Update them</button>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5" onClick={() => { setBuilderError(null); setEditing({ id: t.id, value: { name: t.name, description: t.description, category: t.category, triggerType: t.trigger_type, steps: t.steps } }); }}>Edit</button>
                  <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5" onClick={() => void act(() => authFetch(`/api/automation/templates/${t.id}/duplicate`, { method: 'POST' }), 'Could not duplicate', () => 'Duplicated.')}>Duplicate</button>
                  <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5" onClick={() => setHistoryFor(historyFor === t.id ? null : t.id)}>{historyFor === t.id ? 'All history' : 'History'}</button>
                  <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-red-300 hover:bg-white/5" onClick={() => { if (window.confirm(`Delete "${t.name}"? It will stop running on ${t.dealCount} ${t.dealCount === 1 ? 'file' : 'files'} and cancel anything it had queued.`)) void act(() => authFetch(`/api/automation/templates/${t.id}`, { method: 'DELETE' }), 'Could not delete', () => 'Deleted.'); }}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8" data-testid="automations-page">
      <header>
        <h1 className="text-2xl font-bold text-white">Automations</h1>
        <p className="mt-1 text-sm text-slate-400">Build a workflow once, then apply it to any transaction or listing. Each file gets its own copy, so editing a workflow never changes work already running unless you choose to update it.</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p>}

      {editing ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">{editing.id ? 'Edit automation' : 'New automation'}</h2>
          <AutomationBuilder initial={editing.value} editing={Boolean(editing.id)} saving={saving} error={builderError} onSave={(v) => void save(v)} onCancel={() => setEditing(null)} />
        </section>
      ) : (
        <>
          <PresetLibrary busy={saving} owned={new Set((templates ?? []).map((t) => t.name))} onAdd={(p) => void addPreset(p)} onCustomize={(p) => { setBuilderError(null); setEditing({ id: null, value: presetValue(p) }); window.scrollTo({ top: 0 }); }} />
          <h2 className="border-t border-white/10 pt-6 text-xl font-semibold text-white">Your automations</h2>
          {section('transaction', 'Transaction automations', 'Run on purchase and sale transactions.')}
          {section('listing', 'Listing automations', 'Run on listings. Email steps are not available for listings yet.')}
          <section className="space-y-2" data-testid="automation-history">
            <h2 className="text-lg font-semibold text-white">{historyFor ? 'History for this automation' : 'Recent activity'}</h2>
            {runs.length === 0 ? <p className="text-sm text-slate-500">Nothing has run yet.</p> : (
              <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
                {runs.map((r) => {
                  const [text, tone] = STATUS[r.status] ?? [r.status, 'text-slate-300'];
                  return (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white">{r.label}</p>
                        <p className="truncate text-xs text-slate-400">{r.summary}</p>
                        {r.reason && <p className="text-xs text-slate-500">{r.reason}</p>}
                      </div>
                      <div className="text-right text-xs"><p className={tone}>{text}</p><p className="text-slate-500">{new Date(r.executedAt ?? r.createdAt).toLocaleString()}</p></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
