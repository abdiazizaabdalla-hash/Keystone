'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { MESSAGE_MAX, TRIGGERS, WORKFLOW_PRESETS, describeWorkflow, triggerOf, type OwnerMode, type WorkflowTrigger } from '@/lib/brokerageAutomationRules';

// The broker's Automations: a short list of rules that watch the whole office and tell the right person, once. Each one is a fixed
// trigger and action you can switch on and tune; there is no AI in them. Owner only.

interface ParamDef { key: string; label: string; unit?: string; min: number; max: number; default: number }
interface Rule {
  kind: string; name: string; blurb: string; trigger: string; action: string; params: ParamDef[]; agentNotice: boolean; hasMessage?: boolean;
  enabled: boolean; settings: Record<string, number | string>; agentIds: string[]; notifyAgents: boolean;
}
interface RunItem { address: string; agent: string; reason: string; told: string }
interface Run { id: string; kind: string; label?: string | null; ran_at: string; status: 'ok' | 'nothing' | 'failed'; flagged: number; emails: number; summary: string; detail?: { items?: RunItem[] } | null }
interface Workflow { id: string; name: string; trigger: WorkflowTrigger; amount: number; notifyAgent: boolean; notifyOwner: OwnerMode; escalateDays: number; agentIds: string[]; dealTypes: string[]; enabled: boolean; description: string }
interface Data { automations: Rule[]; workflows: Workflow[]; dealTypes: string[]; agents: { id: string; name: string }[]; runs: Run[] }
type Draft = Omit<Workflow, 'id' | 'description'> & { id?: string }
const blank: Draft = { name: '', trigger: 'quiet', amount: 5, notifyAgent: true, notifyOwner: 'escalate', escalateDays: 2, agentIds: [], dealTypes: [], enabled: true };

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


function WorkflowBuilder({ initial, agents, dealTypes, onClose, onSaved }: { initial: Draft; agents: Data['agents']; dealTypes: string[]; onClose: () => void; onSaved: (note: string) => Promise<void> }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = triggerOf(d.trigger);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch('/api/brokerage/automations/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      await onSaved(`Saved “${d.name}”.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const label = 'block text-xs uppercase tracking-wider text-slate-500 mb-1';
  return (
    <section className={`${card} p-5 mb-5 border-blue-500/40`} aria-label="Workflow builder">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-slate-100 font-semibold">{d.id ? 'Edit workflow' : 'New workflow'}</h2>
        <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
      </div>
      <div className="space-y-5">
        <label className="block">
          <span className={label}>Name</span>
          <input value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Stalled listing contracts" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100" />
        </label>

        <div>
          <span className={label}>1. When</span>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <select aria-label="Trigger" value={d.trigger} onChange={(e) => { const nt = triggerOf(e.target.value as WorkflowTrigger); set({ trigger: nt.id, amount: nt.default }); }} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100">
              {TRIGGERS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {t.amountLabel && (
              <>
                {t.amountLabel}
                <input type="number" aria-label={t.unit} min={t.min} max={t.max} value={d.amount} onChange={(e) => set({ amount: Number(e.target.value) })} className={input} />
                {t.unit}
              </>
            )}
          </div>
        </div>

        <fieldset>
          <legend className={label}>2. Then tell</legend>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={d.notifyAgent} onChange={(e) => set({ notifyAgent: e.target.checked })} /> The agent</label>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-slate-300">
            You:
            <select aria-label="When to tell you" value={d.notifyOwner} onChange={(e) => set({ notifyOwner: e.target.value as OwnerMode })} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100">
              <option value="escalate">Only if still unresolved</option>
              <option value="now">Right away</option>
              <option value="never">Not at all</option>
            </select>
            {d.notifyOwner === 'escalate' && d.notifyAgent && (<>after <input type="number" aria-label="Days before telling you" min={1} max={30} value={d.escalateDays} onChange={(e) => set({ escalateDays: Number(e.target.value) })} className={input} /> more days</>)}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>3. Which agents</legend>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" checked={d.agentIds.length === 0} onChange={() => set({ agentIds: [] })} /> Entire brokerage</label>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" disabled={agents.length === 0} checked={d.agentIds.length > 0} onChange={() => set({ agentIds: agents.slice(0, 1).map((a) => a.id) })} /> Selected agents</label>
          {d.agentIds.length > 0 && (
            <div className="mt-2 grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={d.agentIds.includes(a.id)} onChange={(e) => set({ agentIds: e.target.checked ? [...d.agentIds, a.id] : d.agentIds.filter((x) => x !== a.id) })} /> {a.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {dealTypes.length > 0 && (
          <fieldset>
            <legend className={label}>4. Which deal types</legend>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" checked={d.dealTypes.length === 0} onChange={() => set({ dealTypes: [] })} /> Every deal type</label>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="radio" checked={d.dealTypes.length > 0} onChange={() => set({ dealTypes: dealTypes.slice(0, 1) })} /> Only these</label>
            {d.dealTypes.length > 0 && (
              <div className="mt-2 grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                {dealTypes.map((n) => (
                  <label key={n} className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={d.dealTypes.includes(n)} onChange={(e) => set({ dealTypes: e.target.checked ? [...d.dealTypes, n] : d.dealTypes.filter((x) => x !== n) })} /> {n}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <p className="text-sm text-slate-300 bg-white/5 rounded-lg px-3 py-2">{describeWorkflow(d)}. Each file is told about once.</p>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Switch it on</label>
        <button type="button" disabled={busy} onClick={save} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">{busy ? 'Saving…' : 'Save workflow'}</button>
      </div>
    </section>
  );
}

function WorkflowCard({ w, agents, onEdit, onChanged, onNote }: { w: Workflow; agents: Data['agents']; onEdit: () => void; onChanged: () => Promise<void>; onNote: (n: string) => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const act = async (kind: 'toggle' | 'run' | 'delete') => {
    if (kind === 'delete' && !window.confirm(`Delete “${w.name}”? What it already sent stays in the history.`)) return;
    setBusy(kind);
    setError('');
    try {
      let res: Response;
      if (kind === 'delete') res = await authFetch(`/api/brokerage/automations/workflows?id=${w.id}`, { method: 'DELETE' });
      else if (kind === 'run') res = await authFetch('/api/brokerage/automations/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId: w.id }) });
      else res = await authFetch('/api/brokerage/automations/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...w, enabled: !w.enabled }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong');
      if (kind === 'run') onNote(`${w.name}: ${body.result?.summary ?? 'done'}`);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy('');
    }
  };
  const scope = `${w.agentIds.length ? `${w.agentIds.length} of ${agents.length} agents` : 'All agents'} · ${w.dealTypes.length ? w.dealTypes.join(', ') : 'all deal types'}`;
  return (
    <li className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-slate-100 font-semibold">{w.name}</p>
          <p className="text-sm text-slate-400 mt-0.5">{w.description}</p>
          <p className="text-xs text-slate-500 mt-1">{scope}</p>
        </div>
        <button type="button" role="switch" aria-checked={w.enabled} aria-label={`${w.name} ${w.enabled ? 'on' : 'off'}`} disabled={busy === 'toggle'} onClick={() => act('toggle')} className={`shrink-0 w-12 h-7 rounded-full transition relative ${w.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
          <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all ${w.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="flex gap-4 mt-3 text-sm">
        <button type="button" onClick={onEdit} className="text-blue-400 hover:text-blue-300">Edit</button>
        {w.enabled && <button type="button" disabled={busy === 'run'} onClick={() => act('run')} className="text-slate-300 hover:text-white disabled:opacity-50">{busy === 'run' ? 'Checking…' : 'Run now'}</button>}
        <button type="button" disabled={busy === 'delete'} onClick={() => act('delete')} className="text-slate-500 hover:text-red-300">Delete</button>
      </div>
      {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
    </li>
  );
}

export default function BrokerageAutomations() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [loadedAt] = useState(() => Date.now());
  const [building, setBuilding] = useState<Draft | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [libBusy, setLibBusy] = useState('');

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
  const week = data.runs.filter((r) => r.ran_at >= new Date(loadedAt - 7 * 86400000).toISOString());
  const activeCount = data.automations.filter((a) => a.enabled).length + data.workflows.filter((w) => w.enabled).length;
  const stats = [
    { label: 'Active workflows', value: activeCount },
    { label: 'Executions this week', value: week.length },
    { label: 'Issues flagged this week', value: week.reduce((n, r) => n + r.flagged, 0) },
  ];
  const labelOf = (r: Run) => r.label || data.automations.find((a) => a.kind === r.kind)?.name || r.kind;
  const addPreset = async (i: number) => {
    const p = WORKFLOW_PRESETS[i];
    setLibBusy(p.name);
    setError('');
    try {
      const res = await authFetch('/api/brokerage/automations/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, agentIds: [], dealTypes: [], enabled: true }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not add');
      setNote(`Added “${p.name}” and switched it on.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setLibBusy('');
    }
  };
  const builtIn = [...data.automations].sort((x, y) => Number(y.enabled) - Number(x.enabled));

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold text-slate-100">Brokerage Automations</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">Keep the office running without chasing anyone. Relay watches every file, flags problems, and tells the right person once. Fixed rules, not AI, checked every morning.</p>
        </div>
        <button type="button" onClick={() => setBuilding({ ...blank })} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">+ Create workflow</button>
      </div>

      <div className="grid grid-cols-3 gap-3 my-5">
        {stats.map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{s.label}</p>
            <p className="text-3xl font-semibold text-slate-100 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">{error}</p>}
      {note && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 mb-3">{note}</p>}

      {building && <WorkflowBuilder initial={building} agents={data.agents} dealTypes={data.dealTypes} onClose={() => setBuilding(null)} onSaved={async (n) => { setNote(n); await load(); }} />}

      <h2 className="text-slate-100 font-semibold mb-2">Your workflows</h2>
      {data.workflows.length === 0 ? (
        <p className={`${card} border-dashed p-5 text-sm text-slate-400 mb-6`}>You have not made any yet. Create one, or add one from the library below.</p>
      ) : (
        <ul className="space-y-3 mb-6">
          {data.workflows.map((w) => <WorkflowCard key={w.id} w={w} agents={data.agents} onEdit={() => setBuilding({ ...w })} onChanged={load} onNote={setNote} />)}
        </ul>
      )}

      <h2 className="text-slate-100 font-semibold mb-1">Built-in rules</h2>
      <p className="text-sm text-slate-400 mb-3">Ready to switch on. Each can be tuned and limited to chosen agents.</p>
      <ul className="space-y-3 mb-6">
        {builtIn.map((r) => <RuleCard key={r.kind} rule={r} agents={data.agents} onSaved={load} onRan={async (n) => { setNote(n); await load(); }} />)}
      </ul>

      <h2 className="text-slate-100 font-semibold mb-1">Template library</h2>
      <p className="text-sm text-slate-400 mb-3">More workflows you can add in one click, then change.</p>
      <ul className="grid sm:grid-cols-2 gap-3 mb-6">
        {WORKFLOW_PRESETS.map((p, i) => (
          <li key={p.name} className={`${card} p-4 flex flex-col justify-between gap-3`}>
            <div>
              <p className="text-sm font-semibold text-slate-100">{p.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{p.blurb}</p>
              <p className="text-xs text-slate-500 mt-1">{describeWorkflow(p)}</p>
            </div>
            <button type="button" disabled={libBusy === p.name} onClick={() => addPreset(i)} className="self-start text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50">{libBusy === p.name ? 'Adding…' : '+ Add and switch on'}</button>
          </li>
        ))}
      </ul>

      <section className={card}>
        <h2 className="px-5 py-3 text-sm font-semibold text-slate-100 border-b border-white/5">Execution history</h2>
        {data.runs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nothing has run yet. Switch something on and use Run now to see it work.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.runs.map((r) => {
              const items = r.detail?.items ?? [];
              const expanded = openRun === r.id;
              return (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-slate-100">{labelOf(r)}</span>
                      <span className="text-slate-500"> · {r.summary}</span>
                    </div>
                    <div className="text-xs text-slate-500 shrink-0"><span className={STATUS[r.status][1]}>{STATUS[r.status][0]}</span> · {when(r.ran_at)}</div>
                  </div>
                  {items.length > 0 && (
                    <>
                      <button type="button" onClick={() => setOpenRun(expanded ? null : r.id)} className="text-xs text-blue-400 hover:text-blue-300 mt-1">{expanded ? 'Hide details' : `Why and who was told (${items.length})`}</button>
                      {expanded && (
                        <ul className="mt-2 space-y-1 border-l border-white/10 pl-3">
                          {items.map((it, i) => (
                            <li key={i} className="text-xs text-slate-400"><span className="text-slate-200">{it.address}</span> · {it.agent} · {it.reason} → told {it.told}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
