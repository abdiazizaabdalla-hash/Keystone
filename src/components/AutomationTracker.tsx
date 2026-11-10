'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { summarizeSteps } from '@/components/ApplyAutomations';

// The Tracker tab of one deal or listing: every automation on it, step by step. What ran, what is waiting for you, what is
// scheduled for which day, what was held back and why. From here you can run a step (or the rest) right now, approve a draft,
// pause or remove an automation, and add another at any time.

type State = 'done' | 'needs_ok' | 'waiting' | 'not_done' | 'failed' | 'cancelled' | 'scheduled' | 'due' | 'held' | 'skipped' | 'waiting_trigger';
interface Step { id: string; type: string; when: string; what: string; state: State; due: string | null; note: string; lastAt: string | null; manual: boolean; pendingActionId: string | null }
interface Auto { id: string; templateId: string | null; name: string; triggerLabel: string; status: string; missingRoles: string[]; done: number; total: number; steps: Step[] }
interface Progress { automations: Auto[]; mode: 'off' | 'draft' | 'auto'; paused: boolean; outboxOnly: boolean }
interface Template { id: string; name: string; category: string; active: boolean; trigger_type: string; steps: Parameters<typeof summarizeSteps>[0] }

const STATE: Record<State, { label: string; tone: string; dot: string }> = {
  done: { label: 'Done', tone: 'text-emerald-300', dot: 'bg-emerald-400' },
  needs_ok: { label: 'Needs your OK', tone: 'text-amber-300', dot: 'bg-amber-400' },
  waiting: { label: 'Held, will go later', tone: 'text-sky-300', dot: 'bg-sky-400' },
  not_done: { label: 'Not done', tone: 'text-slate-300', dot: 'bg-slate-400' },
  failed: { label: 'Failed', tone: 'text-red-300', dot: 'bg-red-400' },
  cancelled: { label: 'Cancelled', tone: 'text-slate-400', dot: 'bg-slate-500' },
  scheduled: { label: 'Scheduled', tone: 'text-sky-300', dot: 'bg-sky-400/60' },
  due: { label: 'Due now', tone: 'text-sky-300', dot: 'bg-sky-400' },
  held: { label: 'Held back', tone: 'text-amber-300', dot: 'bg-amber-400/60' },
  skipped: { label: 'Skipped', tone: 'text-slate-400', dot: 'bg-slate-500' },
  waiting_trigger: { label: 'Waiting to start', tone: 'text-slate-400', dot: 'bg-slate-500' },
};
const RESULT_WORDS: Record<string, string> = { executed: 'done', awaiting_approval: 'ready for your approval', deferred: 'held until quiet hours end', refused: 'not done', failed: 'failed', already_running: 'was just run' };
const MODE_WORDS = { off: 'Off: nothing runs on this file', draft: 'Draft: emails wait for your approval', auto: 'Auto: emails send on their own' } as const;

const dateText = (iso: string | null) => (iso ? (iso.length <= 10 ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : '');
const btn = 'rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50';

export default function AutomationTracker({ transactionId, listingId }: { transactionId?: string; listingId?: string }) {
  const [data, setData] = useState<Progress | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const qs = transactionId ? `transactionId=${transactionId}` : `listingId=${listingId}`;
  const category = transactionId ? 'transaction' : 'listing';

  const load = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([authFetch(`/api/automation/progress?${qs}`), authFetch('/api/automation/templates')]);
      if (!p.ok) throw new Error((await p.json().catch(() => ({}))).error || 'Could not load the tracker');
      setData(await p.json());
      if (t.ok) setTemplates((await t.json()).templates);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the tracker');
    }
  }, [qs]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!isFeatureOnClient('automation')) return null;

  const act = async (key: string, url: string, method: string, body?: unknown, after?: (out: Record<string, unknown>) => string | null) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'That did not work');
      setError(null);
      setMessage(after ? after(out) : null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };
  const runWords = (names: Map<string, string>) => (out: Record<string, unknown>) => {
    const rs = (out.results as { stepId: string; status: string; message: string | null }[] | undefined) ?? [];
    if (rs.length === 0) return 'Everything in this automation has already been handled.';
    return rs.map((r) => `${names.get(r.stepId) ?? 'Step'}: ${RESULT_WORDS[r.status] ?? r.status}${r.message ? ` (${r.message.replace(/\.$/, '')})` : ''}`).join('. ') + '.';
  };
  const run = (a: Auto, step?: Step) => {
    const names = new Map(a.steps.map((s) => [s.id, s.what]));
    if (!step && !window.confirm(`Run every step of "${a.name}" that has not been handled yet, right now, ignoring its schedule?`)) return;
    void act(`run-${a.id}-${step?.id ?? 'all'}`, `/api/automation/instances/${a.id}/run`, 'POST', step ? { stepId: step.id } : {}, runWords(names));
  };
  const decide = (step: Step, decision: 'approve' | 'reject') => step.pendingActionId && void act(step.pendingActionId, `/api/automation/actions/${step.pendingActionId}/decide`, 'POST', { decision }, () => (decision === 'approve' ? 'Approved.' : 'Rejected.'));
  const setMode = (mode: string) => act('mode', '/api/automation/settings', 'PUT', { transactionId, listingId, mode });

  const applied = new Set((data?.automations ?? []).map((a) => a.templateId).filter(Boolean));
  const available = (templates ?? []).filter((t) => t.category === category && t.active && !applied.has(t.id));
  const stepsDone = (data?.automations ?? []).reduce((n, a) => n + a.done, 0);
  const stepsAll = (data?.automations ?? []).reduce((n, a) => n + a.total, 0);
  const waiting = (data?.automations ?? []).reduce((n, a) => n + a.steps.filter((s) => s.state === 'needs_ok').length, 0);

  return (
    <section className="space-y-5" data-testid="automation-tracker">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Automation tracker</h3>
          <p className="text-sm text-slate-400">
            {data ? (data.automations.length === 0 ? 'Nothing is running on this file yet.' : `${data.automations.length} automation${data.automations.length === 1 ? '' : 's'} · ${stepsDone} of ${stepsAll} steps done${waiting ? ` · ${waiting} waiting for you` : ''}`) : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => void load()} disabled={busy !== null}>Refresh</button>
          <button type="button" className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400" onClick={() => setAdding((v) => !v)} data-testid="tracker-add">{adding ? 'Close' : 'Add an automation'}</button>
        </div>
      </div>

      {data && data.mode === 'off' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
          <p className="text-sm text-amber-200">{MODE_WORDS.off}. Steps that need to email or change anything will be refused until you turn it on.</p>
          <button type="button" className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-slate-900 disabled:opacity-60" disabled={busy !== null} onClick={() => void setMode('draft')}>Turn on (Draft)</button>
        </div>
      )}
      {data && data.mode !== 'off' && <p className="text-xs text-slate-500">{MODE_WORDS[data.mode]}. Change it in the Automation tab.</p>}
      {data?.paused && <p className="text-sm text-amber-300">Automations are paused for your whole account.</p>}
      {data?.outboxOnly && <p className="text-xs text-slate-500">Test environment: emails go to the outbox, not out.</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-white/5 p-2 text-sm text-slate-200">{message}</p>}

      {adding && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3" data-testid="tracker-add-panel">
          {templates === null ? <p className="text-sm text-slate-500">Loading…</p> : available.length === 0 ? (
            <p className="text-sm text-slate-400">Every {category} automation you have is already on this file. <Link href="/dashboard/automations" className="text-blue-300 hover:text-blue-200">Build or pick another in Automations</Link>.</p>
          ) : (
            <ul className="divide-y divide-white/10">
              {available.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0"><p className="truncate text-sm text-white">{t.name}</p><p className="truncate text-xs text-slate-400">{summarizeSteps(t.steps)}</p></div>
                  <button type="button" className={btn} disabled={busy !== null} onClick={() => void act(`add-${t.id}`, '/api/automation/instances', 'POST', { transactionId, listingId, templateIds: [t.id] }, () => `Added "${t.name}".`)}>Add</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data?.automations.map((a) => (
        <article key={a.id} className={`rounded-2xl border border-white/10 bg-white/5 ${a.status === 'paused' ? 'opacity-80' : ''}`} data-testid="tracker-automation">
          <header className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-white">{a.name}{a.status === 'paused' && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">Paused</span>}</p>
              <p className="text-xs text-slate-400">Starts from: {a.triggerLabel.toLowerCase()} · {a.done} of {a.total} done</p>
              <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400" style={{ width: `${a.total ? Math.round((a.done / a.total) * 100) : 0}%` }} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {a.status === 'active' && <button type="button" className={btn} disabled={busy !== null} onClick={() => run(a)}>Run what is left now</button>}
              <button type="button" className={btn} disabled={busy !== null} onClick={() => void act(`pause-${a.id}`, `/api/automation/instances/${a.id}`, 'PATCH', { status: a.status === 'paused' ? 'active' : 'paused' })}>{a.status === 'paused' ? 'Resume' : 'Pause'}</button>
              <button type="button" className={btn} disabled={busy !== null} onClick={() => window.confirm(`Take "${a.name}" off this file? Anything it had queued is cancelled; what already happened stays in the history.`) && void act(`rm-${a.id}`, `/api/automation/instances/${a.id}`, 'DELETE')}>Remove</button>
            </div>
          </header>
          {a.missingRoles.length > 0 && <p className="px-4 pb-2 text-xs text-amber-300" data-testid="tracker-missing-roles">No {a.missingRoles.join(' or ')} with an email on this file, so that email will not go. Add them in Contacts.</p>}
          <ol className="divide-y divide-white/10 border-t border-white/10">
            {a.steps.map((s) => {
              const st = STATE[s.state];
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" data-testid="tracker-step" data-state={s.state}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm text-white">{s.what}</p>
                      <p className="text-xs text-slate-500">{s.when}{s.due && s.state !== 'done' ? ` · ${dateText(s.due)}` : ''}{s.manual ? ' · run by you' : ''}</p>
                      <p className="mt-0.5 text-xs"><span className={st.tone}>{st.label}</span>{s.lastAt ? <span className="text-slate-500"> · {dateText(s.lastAt)}</span> : null}{s.note ? <span className="text-slate-400"> · {s.note}</span> : null}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {s.state === 'needs_ok' && s.pendingActionId && (
                      <>
                        <button type="button" className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs text-white disabled:opacity-60" disabled={busy !== null} onClick={() => decide(s, 'approve')}>Approve</button>
                        <button type="button" className={btn} disabled={busy !== null} onClick={() => decide(s, 'reject')}>Reject</button>
                      </>
                    )}
                    {a.status === 'active' && s.state !== 'needs_ok' && (
                      <button type="button" className={btn} disabled={busy !== null} onClick={() => run(a, s)} data-testid="tracker-run-step">{s.state === 'done' ? 'Run again' : 'Run now'}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </article>
      ))}
      {data && data.automations.length > 0 && <p className="text-xs text-slate-500">Dates follow the file: if the closing date or another date moves, the steps move with it. Running a step here uses the same rules as a scheduled one (who can be emailed, daily limit, your approval on Draft).</p>}
    </section>
  );
}
