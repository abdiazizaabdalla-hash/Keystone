'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { notifyAutomationChanged } from '@/components/AutomationAlerts';
import { isFeatureOnClient } from '@/lib/features';
import { TRIGGERS } from '@/lib/automation/library';
import { summarizeSteps } from '@/components/ApplyAutomations';

// The Automation tab of one deal or listing: every automation you have, switched on or off for this file, then what has
// happened (and any draft waiting for your approval). Switching one on applies a separate copy; off removes it and cancels
// anything it had queued.

type Mode = 'off' | 'draft' | 'auto';
interface Item {
  id: string;
  kind: string;
  label: string;
  summary: string;
  status: string;
  reason: string | null;
  createdAt: string;
  executedAt: string | null;
  draft: { inputs: Record<string, unknown> } | null;
}
interface Data {
  outboxOnly: boolean;
  paused: boolean;
  settings: { mode: Mode };
  activity: Item[];
}
interface Applied { id: string; template_id: string | null; name: string; trigger_type: string; steps: Parameters<typeof summarizeSteps>[0]; status: string; missingRoles?: string[] }
interface Template { id: string; name: string; category: string; active: boolean; trigger_type: string; steps: Parameters<typeof summarizeSteps>[0] }

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Nothing runs on this file.' },
  { id: 'draft', label: 'Draft', hint: 'Emails and changes wait for your approval.' },
  { id: 'auto', label: 'Auto', hint: 'Emails from your automations send on their own.' },
];
const STATUS: Record<string, [string, string]> = {
  executed: ['Done', 'text-emerald-300'], awaiting_approval: ['Needs your OK', 'text-amber-300'], refused: ['Not done', 'text-slate-400'],
  cancelled: ['Cancelled', 'text-slate-400'], failed: ['Failed', 'text-red-300'], deferred: ['Waiting', 'text-sky-300'],
};
const field = 'w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white';

export default function AssistantPanel({ transactionId, listingId }: { transactionId?: string; listingId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [applied, setApplied] = useState<Applied[]>([]);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ subject?: string; message?: string; text?: string }>({});
  const qs = transactionId ? `transactionId=${transactionId}` : `listingId=${listingId}`;
  const category = transactionId ? 'transaction' : 'listing';

  const load = useCallback(async () => {
    try {
      const [a, i, t] = await Promise.all([authFetch(`/api/automation/activity?${qs}`), authFetch(`/api/automation/instances?${qs}`), authFetch('/api/automation/templates')]);
      if (!a.ok) throw new Error((await a.json().catch(() => ({}))).error || 'Could not load automations');
      setData(await a.json());
      if (i.ok) setApplied((await i.json()).instances);
      if (t.ok) setTemplates((await t.json()).templates);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load automations');
    }
  }, [qs]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!isFeatureOnClient('automation')) return null;

  const call = async (key: string, url: string, method: string, body?: unknown) => {
    setBusy(key);
    try {
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'That did not work');
      setError(out.skipped?.[0]?.reason ?? null);
      await load();
      notifyAutomationChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };
  const setMode = (mode: Mode) => call('mode', '/api/automation/settings', 'PUT', { transactionId, listingId, mode });
  const toggle = (t: Template, copy?: Applied) =>
    copy ? call(t.id, `/api/automation/instances/${copy.id}`, 'DELETE') : call(t.id, '/api/automation/instances', 'POST', { transactionId, listingId, templateIds: [t.id] });
  const decide = (id: string, decision: 'approve' | 'reject', edited?: unknown) => call(id, `/api/automation/actions/${id}/decide`, 'POST', { decision, edited }).then(() => setEditing(null));

  const mode = data?.settings.mode ?? 'off';
  // Every automation of this kind, plus any copy whose original was edited away or deleted.
  const rows = [
    ...(templates ?? []).filter((t) => t.category === category && (t.active || applied.some((a) => a.template_id === t.id))).map((t) => ({ key: t.id, name: t.name, trigger: t.trigger_type, steps: t.steps, tpl: t as Template | null, copy: applied.find((a) => a.template_id === t.id) })),
    ...applied.filter((a) => !a.template_id).map((a) => ({ key: a.id, name: a.name, trigger: a.trigger_type, steps: a.steps, tpl: null, copy: a })),
  ];

  return (
    <section className="space-y-6" data-testid="assistant-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Automations</h3>
          <p className="text-sm text-slate-400">{MODES.find((m) => m.id === mode)?.hint}</p>
        </div>
        <div role="radiogroup" aria-label="Automation mode" className="inline-flex overflow-hidden rounded-lg border border-white/10">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} disabled={busy !== null || !data} onClick={() => void setMode(m.id)} data-testid={`assistant-mode-${m.id}`}
              className={`px-3 py-1.5 text-sm ${mode === m.id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/5'}`}>{m.label}</button>
          ))}
        </div>
      </div>
      {data?.paused && <p className="text-sm text-amber-300">Automations are paused for your whole account.</p>}
      {data?.outboxOnly && <p className="text-xs text-slate-500">Test environment: emails go to the outbox, not out.</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-200">Your automations</h4>
        {templates === null ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="text-sm text-slate-500">You have no {category} automations yet. <Link href="/dashboard/automations" className="text-blue-300 hover:text-blue-200">Add one</Link>.</p>
        ) : (
          <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5" data-testid="applied-automations">
            {rows.map((r) => {
              const on = Boolean(r.copy);
              return (
                <li key={r.key} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{r.name}</p>
                    <p className="truncate text-xs text-slate-400">{TRIGGERS.find((t) => t.id === r.trigger)?.label} · {summarizeSteps(r.steps)}{r.copy?.status === 'paused' ? ' · paused' : ''}</p>
                    {r.copy?.missingRoles && r.copy.missingRoles.length > 0 && (
                      <p className="mt-1 text-xs text-amber-300" data-testid="missing-roles">No {r.copy.missingRoles.join(' or ')} with an email on this deal or listing, so that email will be skipped. Add them in Contacts.</p>
                    )}
                  </div>
                  <button type="button" role="switch" aria-checked={on} aria-label={`${r.name} on this ${category}`} disabled={busy !== null}
                    onClick={() => (r.tpl ? void toggle(r.tpl, r.copy) : r.copy && void call(r.key, `/api/automation/instances/${r.copy.id}`, 'DELETE'))}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${on ? 'bg-emerald-500' : 'bg-white/20'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 0 && <p className="mt-2 text-xs text-slate-500"><Link href="/dashboard/automations" className="text-blue-300 hover:text-blue-200">Manage or add more</Link></p>}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-200">Activity</h4>
        {!data ? <p className="text-sm text-slate-500">Loading…</p> : data.activity.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.{mode === 'off' ? ' Turn automations on above to get started.' : ''}</p>
        ) : (
          <ul className="space-y-2">
            {data.activity.map((a) => {
              const [text, tone] = STATUS[a.status] ?? [a.status, 'text-slate-400'];
              return (
                <li key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="assistant-item">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-white">{a.summary || a.label}</p>
                    <span className={`shrink-0 text-xs ${tone}`}>{text}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{a.reason ? `${a.reason} · ` : ''}{new Date(a.executedAt ?? a.createdAt).toLocaleDateString()}</p>
                  {a.draft && (editing === a.id ? (
                    <div className="mt-2 space-y-2">
                      {typeof a.draft.inputs.subject === 'string' && <input aria-label="Subject" className={field} defaultValue={a.draft.inputs.subject} onChange={(e) => setEdit((x) => ({ ...x, subject: e.target.value }))} />}
                      {typeof a.draft.inputs.message === 'string' && <textarea aria-label="Message" rows={6} className={field} defaultValue={a.draft.inputs.message} onChange={(e) => setEdit((x) => ({ ...x, message: e.target.value }))} />}
                      {typeof a.draft.inputs.text === 'string' && <textarea aria-label="Note" rows={3} className={field} defaultValue={a.draft.inputs.text} onChange={(e) => setEdit((x) => ({ ...x, text: e.target.value }))} />}
                      <div className="flex gap-2">
                        <button type="button" disabled={busy !== null} onClick={() => void decide(a.id, 'approve', edit)} className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white">Save and approve</button>
                        <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={busy !== null} onClick={() => void decide(a.id, 'approve')} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-white" data-testid="assistant-approve">Approve</button>
                      <button type="button" disabled={busy !== null} onClick={() => { setEdit({}); setEditing(a.id); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5">Edit</button>
                      <button type="button" disabled={busy !== null} onClick={() => void decide(a.id, 'reject')} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5" data-testid="assistant-reject">Reject</button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
