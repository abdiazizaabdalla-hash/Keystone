'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';

// The assistant on one deal or listing: an Off / Draft / Auto setting and an Activity and Approvals list. Drafts wait here
// for Approve / Edit / Reject. Nothing sends from a draft until a person approves it.

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

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Relay does nothing on this file.' },
  { id: 'draft', label: 'Draft', hint: 'Relay prepares emails and changes; you approve each one.' },
  { id: 'auto', label: 'Auto', hint: 'Relay sends approved-template follow-ups itself; everything else still waits for you.' },
];

const STATUS_STYLE: Record<string, string> = {
  executed: 'text-emerald-300',
  awaiting_approval: 'text-amber-300',
  refused: 'text-slate-400',
  cancelled: 'text-slate-400',
  failed: 'text-red-300',
  deferred: 'text-sky-300',
};
const STATUS_LABEL: Record<string, string> = {
  executed: 'Done',
  awaiting_approval: 'Needs your OK',
  refused: 'Not done',
  cancelled: 'Rejected',
  failed: 'Failed',
  deferred: 'Waiting to retry',
};

export default function AssistantPanel({ transactionId, listingId }: { transactionId?: string; listingId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ subject?: string; message?: string; text?: string; name?: string; dueDate?: string; date?: string }>({});
  const qs = transactionId ? `transactionId=${transactionId}` : `listingId=${listingId}`;

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/automation/activity?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load the assistant');
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the assistant');
    }
  }, [qs]);
  useEffect(() => {
    // Deferred so the first fetch's setState never runs synchronously inside the effect body.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!isFeatureOnClient('automation')) return null;

  const call = async (url: string, method: string, body: unknown) => {
    setBusy(true);
    try {
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That did not work');
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const setMode = (mode: Mode) => call('/api/automation/settings', 'PUT', { transactionId, listingId, mode });
  const decide = (id: string, decision: 'approve' | 'reject', edits?: unknown) => call(`/api/automation/actions/${id}/decide`, 'POST', { decision, edited: edits }).then(() => setEditing(null));
  const mode = data?.settings.mode ?? 'off';

  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-6" data-testid="assistant-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold text-white">Assistant</h3>
        <div role="radiogroup" aria-label="Assistant mode" className="inline-flex rounded-lg border border-white/10 overflow-hidden">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} disabled={busy || !data} onClick={() => void setMode(m.id)} data-testid={`assistant-mode-${m.id}`}
              className={`px-3 py-1.5 text-sm ${mode === m.id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/5'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-slate-400">{MODES.find((m) => m.id === mode)?.hint}</p>
      {data?.paused && <p className="mt-2 text-sm text-amber-300">The assistant is paused for your whole account. Nothing runs until you resume it.</p>}
      {data?.outboxOnly && <p className="mt-2 text-xs text-slate-500">Test environment: emails are saved to the outbox, not sent.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}

      <h4 className="mt-5 mb-2 text-sm font-semibold text-slate-200">Activity and approvals</h4>
      {!data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : data.activity.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing yet. {mode === 'off' ? 'Turn the assistant on to get follow-ups, deadline warnings and missing-document checks.' : 'Relay checks this file every hour.'}</p>
      ) : (
        <ul className="space-y-3">
          {data.activity.map((a) => (
            <li key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="assistant-item">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-white">{a.label}</span>
                <span className={`text-xs ${STATUS_STYLE[a.status] ?? 'text-slate-400'}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
              </div>
              <p className="mt-1 text-sm text-slate-300 whitespace-pre-wrap">{a.summary}</p>
              {a.reason && <p className="mt-1 text-xs text-slate-500">{a.reason}</p>}
              <p className="mt-1 text-xs text-slate-500">{new Date(a.executedAt ?? a.createdAt).toLocaleString()}</p>
              {a.draft && (
                <div className="mt-2">
                  {editing === a.id ? (
                    <div className="space-y-2">
                      {typeof a.draft.inputs.subject === 'string' && <input aria-label="Subject" className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white" defaultValue={a.draft.inputs.subject} onChange={(e) => setEdit((x) => ({ ...x, subject: e.target.value }))} />}
                      {typeof a.draft.inputs.message === 'string' && <textarea aria-label="Message" rows={6} className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white" defaultValue={a.draft.inputs.message} onChange={(e) => setEdit((x) => ({ ...x, message: e.target.value }))} />}
                      {typeof a.draft.inputs.text === 'string' && <textarea aria-label="Note" rows={3} className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white" defaultValue={a.draft.inputs.text} onChange={(e) => setEdit((x) => ({ ...x, text: e.target.value }))} />}
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void decide(a.id, 'approve', edit)} className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white">Save and approve</button>
                        <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => void decide(a.id, 'approve')} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-white" data-testid="assistant-approve">Approve</button>
                      <button type="button" disabled={busy} onClick={() => { setEdit({}); setEditing(a.id); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5">Edit</button>
                      <button type="button" disabled={busy} onClick={() => void decide(a.id, 'reject')} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5" data-testid="assistant-reject">Reject</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
