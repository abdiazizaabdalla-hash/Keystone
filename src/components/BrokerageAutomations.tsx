'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { MESSAGE_MAX } from '@/lib/brokerageAutomationRules';

// The broker's Automations: a short list of rules that watch the whole office and tell the right person, once. Each one is a fixed
// trigger and action you can switch on and tune; there is no AI in them. Owner only.

interface ParamDef { key: string; label: string; unit?: string; min: number; max: number; default: number }
interface Rule {
  kind: string; name: string; blurb: string; trigger: string; action: string; params: ParamDef[]; agentNotice: boolean; hasMessage?: boolean;
  enabled: boolean; settings: Record<string, number | string>; agentIds: string[]; notifyAgents: boolean;
}
interface Run { id: string; kind: string; ran_at: string; status: 'ok' | 'nothing' | 'failed'; flagged: number; emails: number; summary: string }
interface Data { automations: Rule[]; agents: { id: string; name: string }[]; runs: Run[] }

const card = 'bg-white/5 border border-white/10 rounded-2xl';
const input = 'bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100 w-20';
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS = { ok: ['Done', 'text-emerald-300'], nothing: ['Nothing to do', 'text-slate-400'], failed: ['Failed', 'text-red-300'] } as const;

function RuleCard({ rule, agents, onSaved, onRan }: { rule: Rule; agents: Data['agents']; onSaved: () => Promise<void>; onRan: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(rule);
  const [busy, setBusy] = useState<'save' | 'run' | ''>('');
  const [error, setError] = useState('');
  const changed = useMemo(() => JSON.stringify({ ...draft, runs: 0 }) !== JSON.stringify({ ...rule, runs: 0 }), [draft, rule]);

  const save = async (next: Rule) => {
    setBusy('save');
    setError('');
    try {
      const res = await authFetch('/api/brokerage/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: next.kind, enabled: next.enabled, params: next.settings, agentIds: next.agentIds, notifyAgents: next.notifyAgents }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy('');
    }
  };
  const run = async () => {
    setBusy('run');
    setError('');
    try {
      const res = await authFetch('/api/brokerage/automations/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: rule.kind }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not run');
      await onRan(`${rule.name}: ${body.result?.summary ?? 'done'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run');
    } finally {
      setBusy('');
    }
  };
  const toggle = () => { const next = { ...draft, enabled: !rule.enabled }; setDraft(next); save(next); };
  const scoped = draft.agentIds.length > 0;

  return (
    <li className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-slate-100 font-semibold">{rule.name}</p>
          <p className="text-sm text-slate-400 mt-0.5">{rule.blurb}</p>
          <p className="text-xs text-slate-500 mt-2"><span className="text-slate-400">When:</span> {rule.trigger}</p>
          <p className="text-xs text-slate-500"><span className="text-slate-400">Then:</span> {rule.action}</p>
          <p className="text-xs text-slate-500 mt-1">{rule.enabled ? (rule.agentIds.length ? `Watching ${rule.agentIds.length} selected agent${rule.agentIds.length === 1 ? '' : 's'}` : 'Watching every agent') : 'Off'}</p>
        </div>
        <button type="button" role="switch" aria-checked={rule.enabled} aria-label={`${rule.name} ${rule.enabled ? 'on' : 'off'}`} disabled={busy === 'save'} onClick={toggle} className={`shrink-0 w-12 h-7 rounded-full transition relative ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
          <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all ${rule.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex gap-3 mt-3 text-sm">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-blue-400 hover:text-blue-300">{open ? 'Close settings' : 'Settings'}</button>
        {rule.enabled && <button type="button" disabled={busy === 'run'} onClick={run} className="text-slate-300 hover:text-white disabled:opacity-50">{busy === 'run' ? 'Checking…' : 'Run now'}</button>}
      </div>
      {error && <p className="text-sm text-red-300 mt-2">{error}</p>}

      {open && (
        <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
          {rule.params.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {rule.params.map((p) => (
                <label key={p.key} className="text-sm text-slate-300 flex items-center gap-2">
                  {p.label}
                  <input type="number" min={p.min} max={p.max} value={Number(draft.settings[p.key] ?? p.default)} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, [p.key]: Number(e.target.value) } })} className={input} />
                  {p.unit}
                </label>
              ))}
            </div>
          )}
          {rule.hasMessage && (
            <label className="block text-sm text-slate-300">
              Your welcome message (optional)
              <textarea value={String(draft.settings.message ?? '')} maxLength={MESSAGE_MAX} rows={4} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, message: e.target.value } })} placeholder="Welcome to the brokerage. Here is how we run files here…" className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100" />
            </label>
          )}
          <fieldset>
            <legend className="text-xs uppercase tracking-wider text-slate-500 mb-1">Which agents</legend>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" checked={!scoped} onChange={() => setDraft({ ...draft, agentIds: [] })} /> Every agent</label>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" checked={scoped} onChange={() => setDraft({ ...draft, agentIds: agents.slice(0, 1).map((a) => a.id) })} disabled={agents.length === 0} /> Only selected agents</label>
            {scoped && (
              <div className="mt-2 grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                {agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={draft.agentIds.includes(a.id)} onChange={(e) => setDraft({ ...draft, agentIds: e.target.checked ? [...draft.agentIds, a.id] : draft.agentIds.filter((x) => x !== a.id) })} />
                    {a.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {rule.agentNotice && (
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input type="checkbox" className="mt-1" checked={draft.notifyAgents} onChange={(e) => setDraft({ ...draft, notifyAgents: e.target.checked })} />
              <span>Tell the agent too. {rule.kind === 'onboarding' ? '' : 'Off means only you are told, straight away.'}</span>
            </label>
          )}
          <button type="button" disabled={!changed || busy === 'save'} onClick={() => save(draft)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition">{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}
    </li>
  );
}

export default function BrokerageAutomations() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [loadedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await authFetch('/api/brokerage/automations');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load your automations');
    setData(body);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your automations')); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!data) return <p className="p-8 text-sm text-slate-400">{error || 'Loading…'}</p>;
  const names = new Map(data.automations.map((a) => [a.kind, a.name]));
  const weekAgo = new Date(loadedAt - 7 * 86400000).toISOString();
  const week = data.runs.filter((r) => r.ran_at >= weekAgo);
  const stats = [
    { label: 'Rules on', value: data.automations.filter((a) => a.enabled).length },
    { label: 'Checks this week', value: week.length },
    { label: 'Files flagged this week', value: week.reduce((n, r) => n + r.flagged, 0) },
  ];

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <h1 className="font-display text-2xl md:text-3xl font-semibold text-slate-100">Automations</h1>
      <p className="text-sm text-slate-400 mb-5 max-w-2xl">Keep the office running without chasing anyone. Switch on a rule and Relay watches every file, then tells the right person once. These are fixed rules, not AI, and they run every morning.</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {stats.map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{s.label}</p>
            <p className="text-2xl font-semibold text-slate-100 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">{error}</p>}
      {note && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 mb-3">{note}</p>}

      <ul className="space-y-3">
        {data.automations.map((r) => (
          <RuleCard key={r.kind} rule={r} agents={data.agents} onSaved={load} onRan={async (n) => { setNote(n); await load(); }} />
        ))}
      </ul>

      <section className={`${card} mt-6`}>
        <h2 className="px-5 py-3 text-sm font-semibold text-slate-100 border-b border-white/5">What ran</h2>
        {data.runs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nothing has run yet. Switch a rule on and use Run now to see it work.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.runs.map((r) => (
              <li key={r.id} className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="text-slate-100">{names.get(r.kind) ?? r.kind}</span>
                  <span className="text-slate-500"> · {r.summary}</span>
                </div>
                <div className="text-xs text-slate-500 shrink-0"><span className={STATUS[r.status][1]}>{STATUS[r.status][0]}</span> · {when(r.ran_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
