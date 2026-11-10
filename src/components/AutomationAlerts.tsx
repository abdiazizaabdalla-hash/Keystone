'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// Small banners at the top of a deal or listing for what needs a look: a draft email waiting for an OK, a reminder one of the
// automations raised, an email that did not go. Reminders and problems stay until acknowledged ("Got it"). The count also
// shows on the Tracker tab. Other automation screens ping `relay:automation-changed` after they change anything.

export interface AutomationAlert { id: string; kind: 'approval' | 'reminder' | 'problem'; title: string; body: string; at: string; automation: string }
export const AUTOMATION_CHANGED = 'relay:automation-changed';
export const notifyAutomationChanged = () => {
  try {
    window.dispatchEvent(new Event(AUTOMATION_CHANGED));
  } catch {
    /* non-fatal */
  }
};

export function useAutomationAlerts(scope: { transactionId?: string; listingId?: string; enabled: boolean }) {
  const { transactionId, listingId, enabled } = scope;
  const [alerts, setAlerts] = useState<AutomationAlert[]>([]);
  const qs = transactionId ? `transactionId=${transactionId}` : `listingId=${listingId}`;
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await authFetch(`/api/automation/alerts?${qs}`);
      if (res.ok) setAlerts((await res.json()).alerts ?? []);
    } catch {
      /* a banner that cannot load is simply not shown */
    }
  }, [enabled, qs]);
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void load(), 0);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const onChange = () => void load();
    window.addEventListener(AUTOMATION_CHANGED, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      window.removeEventListener(AUTOMATION_CHANGED, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [enabled, load]);
  return { alerts, count: alerts.length, reload: load };
}

const TONE = {
  approval: 'border-amber-400/40 bg-amber-400/10',
  problem: 'border-red-400/40 bg-red-400/10',
  reminder: 'border-sky-400/40 bg-sky-400/10',
} as const;
const LABEL = { approval: 'Needs your OK', problem: 'Did not go', reminder: 'Reminder' } as const;
const SHOWN = 3;

export default function AutomationBanners({ alerts, scope, onOpenTracker, onChanged }: { alerts: AutomationAlert[]; scope: { transactionId?: string; listingId?: string }; onOpenTracker: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (alerts.length === 0) return null;
  const send = async (key: string, url: string, body: unknown) => {
    setBusy(key);
    setError(null);
    try {
      const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That did not work');
      onChanged();
      notifyAutomationChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };
  const seen = alerts.slice(0, SHOWN);
  const dismissable = alerts.filter((a) => a.kind !== 'approval').length;
  return (
    <div className="mb-4 space-y-2" data-testid="automation-banners" role="region" aria-label="Automation alerts">
      {seen.map((a) => (
        <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 ${TONE[a.kind]}`} data-testid="automation-banner" data-kind={a.kind}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-300">{LABEL[a.kind]}</span>{a.kind === 'reminder' ? a.title : a.body || a.title}</p>
            <p className="truncate text-xs text-slate-400">{a.kind === 'reminder' && a.body ? `${a.body} · ` : ''}{a.automation} · {new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {a.kind === 'approval' ? (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void send(a.id, `/api/automation/actions/${a.id}/decide`, { decision: 'approve' })} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs text-white disabled:opacity-60">Approve</button>
                <button type="button" onClick={onOpenTracker} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-100 hover:bg-white/5">Review</button>
              </>
            ) : (
              <button type="button" disabled={busy !== null} onClick={() => void send(a.id, '/api/automation/alerts', { actionId: a.id })} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-100 hover:bg-white/5 disabled:opacity-60">Got it</button>
            )}
          </div>
        </div>
      ))}
      {(alerts.length > SHOWN || dismissable > 1) && (
        <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-slate-400">
          {alerts.length > SHOWN && <button type="button" onClick={onOpenTracker} className="text-blue-300 hover:text-blue-200">{alerts.length - SHOWN} more in the Tracker</button>}
          {dismissable > 1 && <button type="button" disabled={busy !== null} onClick={() => void send('all', '/api/automation/alerts', { ...scope, all: true })} className="text-blue-300 hover:text-blue-200 disabled:opacity-60">Got it for all {dismissable}</button>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    </div>
  );
}
