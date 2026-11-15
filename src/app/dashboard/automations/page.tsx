'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { TRIGGERS, type Category, type Step } from '@/lib/automation/library';
import AutomationBuilder, { blankAutomation, type BuilderValue } from '@/components/AutomationBuilder';
import { summarizeSteps } from '@/components/ApplyAutomations';
import PresetLibrary from '@/components/PresetLibrary';
import type { Preset } from '@/lib/automation/presets';
import WorkflowDialog from '@/components/WorkflowDialog';
import BrokerageAutomations from '@/components/BrokerageAutomations';
import { useBrokerageOwner } from '@/lib/useBrokerageOwner';

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

function AgentAutomationsPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; value: BuilderValue } | null>(null);
  const [saving, setSaving] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [tab, setTab] = useState<'mine' | 'library'>('library');
  const [libError, setLibError] = useState<string | null>(null);
  const [openMine, setOpenMine] = useState<Template | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);

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

  const addFromLibrary = async (v: BuilderValue, stay = false): Promise<boolean> => {
    setSaving(true);
    setLibError(null);
    try {
      const res = await authFetch('/api/automation/templates', { method: 'POST', headers: json, body: JSON.stringify(v) });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not add it'));
      setNotice(`Added "${v.name}". Apply it when you create a transaction or listing, or from a deal's Automation tab.`);
      if (!stay) setTab('mine');
      await load();
      return true;
    } catch (e) {
      setLibError(e instanceof Error ? e.message : 'Could not add it');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // The switch on a Library card: on adds the ready-made automation to Your automations, off removes that copy.
  const togglePreset = async (p: Preset, on: boolean) => {
    if (on) {
      await addFromLibrary({ ...p, description: p.summary } as BuilderValue, true);
      return;
    }
    const mine = (templates ?? []).find((t) => t.name === p.name && t.category === p.category);
    if (!mine) return;
    const unit = mine.category === 'transaction' ? 'transaction' : 'listing';
    const used = mine.dealCount > 0 ? ` It will stop running on ${mine.dealCount} ${unit}${mine.dealCount === 1 ? '' : 's'} and cancel anything queued.` : '';
    if (!window.confirm(`Remove "${mine.name}" from Your automations?${used}`)) return;
    await act(() => authFetch(`/api/automation/templates/${mine.id}`, { method: 'DELETE' }), 'Could not remove it', () => `Removed "${mine.name}".`);
  };

  const saveMine = async (t: Template, v: BuilderValue) => {
    setSaving(true);
    setMineError(null);
    try {
      const res = await authFetch(`/api/automation/templates/${t.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ ...v, category: t.category, triggerType: t.trigger_type }) });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not save'));
      setOpenMine(null);
      setNotice('Saved. Deals already using it keep their own copy until you choose Update them.');
      await load();
    } catch (e) {
      setMineError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const card = (t: Template) => {
    const trig = TRIGGERS.find((x) => x.id === t.trigger_type)?.label ?? t.trigger_type;
    const unit = t.category === 'transaction' ? 'transaction' : 'listing';
    return (
      <div key={t.id} className={`relative min-h-[170px] rounded-2xl border border-white/10 bg-white/5 transition hover:border-blue-400/50 hover:bg-white/10 ${t.active ? '' : 'opacity-70'}`} data-testid="automation-card">
        <button type="button" onClick={() => { setMineError(null); setOpenMine(t); }} className="flex h-full min-h-[170px] w-full flex-col justify-between p-4 pr-16 text-left">
          <span>
            <span className="block text-base font-semibold text-white">{t.name}</span>
            <span className="mt-1 block text-xs text-slate-400">{t.description || `${t.steps.length} ${t.steps.length === 1 ? 'step' : 'steps'}: ${summarizeSteps(t.steps)}`}</span>
          </span>
          <span className="mt-3 block text-xs text-slate-500">
            {trig} · {t.steps.length} steps · {t.dealCount === 0 ? 'not used yet' : `on ${t.dealCount} ${unit}${t.dealCount === 1 ? '' : 's'}`}
            {t.stats.failed > 0 && <span className="text-red-300"> · {t.stats.failed} failed</span>}
            {t.stats.pending > 0 && <span className="text-amber-300"> · {t.stats.pending} waiting</span>}
            {t.outdatedCount > 0 && <span className="text-amber-300"> · edited since used</span>}
          </span>
        </button>
        <button type="button" role="switch" aria-checked={t.active} aria-label={`${t.name} is ${t.active ? 'on' : 'off'}`} title={t.active ? 'On: can be applied to deals' : 'Off: paused everywhere'}
          onClick={() => void act(() => authFetch(`/api/automation/templates/${t.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ active: !t.active }) }), 'Could not switch it', () => (t.active ? 'Turned off. Its copies on deals are paused and anything queued was cancelled.' : 'Turned on.'))}
          className={`absolute right-3 top-3 h-6 w-11 rounded-full transition ${t.active ? 'bg-emerald-500' : 'bg-white/20'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${t.active ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
    );
  };

  const group = (category: Category, title: string) => {
    const list = (templates ?? []).filter((t) => t.category === category);
    if (templates !== null && list.length === 0) return null;
    return (
      <div key={category} data-testid={`automations-${category}`}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map(card)}</div>
      </div>
    );
  };

  const hasAny = (templates ?? []).length > 0;
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8" data-testid="automations-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Automations</h1>
          <p className="text-sm text-slate-400">Build a workflow once, then apply it to any transaction or listing.</p>
        </div>
        {!editing && <button type="button" onClick={() => { setBuilderError(null); setEditing({ id: null, value: blankAutomation('transaction') }); }} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400" data-testid="create-automation">New automation</button>}
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
          <div className="flex gap-6 border-b border-white/10" role="tablist">
            {([['library', 'Library'], ['mine', 'Your automations']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`}
                className={`-mb-px border-b-2 pb-2 text-sm font-medium ${tab === id ? 'border-blue-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{label}</button>
            ))}
          </div>

          {tab === 'mine' ? (
          <section className="space-y-4" data-testid="your-automations">
            {templates === null ? <p className="text-sm text-slate-500">Loading…</p> : !hasAny ? (
              <p className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-400">Nothing here yet. Switch one on in the Library for a starting point, or create your own.</p>
            ) : (
              <>
                {group('transaction', 'Transactions')}
                {group('listing', 'Listings')}
              </>
            )}
            <details open={showActivity} onToggle={(e) => setShowActivity((e.target as HTMLDetailsElement).open)} data-testid="automation-history">
              <summary className="cursor-pointer text-sm text-slate-400">{historyFor ? 'History for the selected automation' : 'Recent activity'}</summary>
              {historyFor && <button type="button" className="mt-2 text-xs text-blue-300 hover:text-blue-200" onClick={() => setHistoryFor(null)}>Show all</button>}
              {runs.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing has run yet.</p> : (
                <ul className="mt-2 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
                  {runs.map((r) => {
                    const [text, tone] = STATUS[r.status] ?? [r.status, 'text-slate-300'];
                    return (
                      <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">{r.summary || r.label}</p>
                          {r.reason && <p className="text-xs text-slate-500">{r.reason}</p>}
                        </div>
                        <div className="text-right text-xs"><p className={tone}>{text}</p><p className="text-slate-500">{new Date(r.executedAt ?? r.createdAt).toLocaleDateString()}</p></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>
          </section>

          ) : (
            <PresetLibrary onToggle={togglePreset} owned={new Set((templates ?? []).map((t) => t.name))} saving={saving} error={libError} onSave={addFromLibrary} onFullEditor={(v) => { setBuilderError(null); setEditing({ id: null, value: v }); window.scrollTo({ top: 0 }); }} />
          )}
        </>
      )}
      {openMine && (() => {
        const t = openMine;
        const unit = t.category === 'transaction' ? 'transaction' : 'listing';
        return (
          <WorkflowDialog key={t.id} preset={{ name: t.name, description: t.description, category: t.category, triggerType: t.trigger_type, steps: t.steps }} saving={saving} error={mineError} saveLabel="Save changes"
            banner={t.outdatedCount > 0 ? (
              <p className="mt-3 text-xs text-amber-200">{t.outdatedCount} {t.outdatedCount === 1 ? unit : `${unit}s`} still run an older version.{' '}
                <button type="button" className="underline" onClick={() => { setOpenMine(null); void act(() => authFetch(`/api/automation/templates/${t.id}/update-copies`, { method: 'POST' }), 'Could not update', (b) => `Updated ${b.updated} ${b.updated === 1 ? unit : `${unit}s`}.`); }}>Update them</button></p>
            ) : undefined}
            footerLeft={<>
              <button type="button" className="text-slate-300 hover:text-white" onClick={() => { setOpenMine(null); void act(() => authFetch(`/api/automation/templates/${t.id}/duplicate`, { method: 'POST' }), 'Could not duplicate', () => 'Duplicated.'); }}>Duplicate</button>
              <button type="button" className="text-slate-300 hover:text-white" onClick={() => { setOpenMine(null); setHistoryFor(t.id); setShowActivity(true); }}>History</button>
              <button type="button" className="text-red-300 hover:text-red-200" onClick={() => { if (window.confirm(`Delete "${t.name}"? It will stop running on ${t.dealCount} ${unit}${t.dealCount === 1 ? '' : 's'} and cancel anything queued.`)) { setOpenMine(null); void act(() => authFetch(`/api/automation/templates/${t.id}`, { method: 'DELETE' }), 'Could not delete', () => 'Deleted.'); } }}>Delete</button>
            </>}
            onClose={() => setOpenMine(null)} onSave={(v) => void saveMine(t, v)}
            onFullEditor={(v) => { setOpenMine(null); setBuilderError(null); setEditing({ id: t.id, value: v }); window.scrollTo({ top: 0 }); }} />
        );
      })()}
    </div>
  );
}

// A brokerage owner gets the brokerage's own automations (watching the office); the agent library of deal-task automations is not shown to them.
export default function AutomationsPage() {
  const owner = useBrokerageOwner();
  if (owner === null) return <p className="p-8 text-sm text-slate-400">Loading…</p>;
  return owner ? <BrokerageAutomations /> : <AgentAutomationsPage />;
}
