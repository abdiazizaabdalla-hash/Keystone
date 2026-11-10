'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { AUTOMATION_CHANGED, notifyAutomationChanged } from '@/components/AutomationAlerts';

// The moment an automation has something that needs your OK, a popup shows what will be sent and asks, wherever you are in Relay:
// Approve and send, Edit first, Reject, or Later. "Later" hides it for this visit only; it comes back next time you open Relay.
// Only drafts that go outside (emails) and changes that need a person land here; reminders and tasks just happen.

interface Approval {
  actionId: string;
  kind: string;
  label: string;
  summary: string;
  inputs: Record<string, unknown>;
  createdAt: string;
  transactionId: string | null;
  listingId: string | null;
  deal: { fileNumber: string | null; address: string } | null;
}
const LATER_KEY = 'relay:approval-later';
const readLater = (): string[] => {
  try {
    return JSON.parse(window.sessionStorage.getItem(LATER_KEY) || '[]');
  } catch {
    return [];
  }
};
const field = 'w-full rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-sm text-white';
const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);

export default function ApprovalPopup() {
  const [items, setItems] = useState<Approval[]>([]);
  const [later, setLater] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ subject?: string; message?: string; text?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/automation/approvals');
      if (res.ok) setItems((await res.json()).approvals ?? []);
    } catch {
      /* no popup if it cannot load */
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => {
      setLater(readLater());
      void load();
    }, 0);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    const again = () => void load();
    window.addEventListener(AUTOMATION_CHANGED, again);
    window.addEventListener('focus', again);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      window.removeEventListener(AUTOMATION_CHANGED, again);
      window.removeEventListener('focus', again);
    };
  }, [load]);

  const queue = items.filter((a) => !later.includes(a.actionId));
  const cur = queue[0];
  if (!cur) return null;

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/automation/actions/${cur.actionId}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...(decision === 'approve' && editing ? { edited: draft } : {}) }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That did not work');
      setEditing(false);
      setDraft({});
      await load();
      notifyAutomationChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };
  const snooze = () => {
    const next = [...later, cur.actionId];
    setLater(next);
    setEditing(false);
    try {
      window.sessionStorage.setItem(LATER_KEY, JSON.stringify(next));
    } catch {
      /* non-fatal */
    }
  };

  const i = cur.inputs;
  const to = list(i.to);
  const subject = typeof i.subject === 'string' ? i.subject : '';
  const message = typeof i.message === 'string' ? i.message : typeof i.text === 'string' ? i.text : '';
  const isEmail = cur.kind === 'send_deal_email' || cur.kind === 'send_step_email';
  const href = cur.transactionId ? `/dashboard/transactions/${cur.transactionId}#automation` : cur.listingId ? `/dashboard/listings/${cur.listingId}#automation` : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Needs your OK" data-testid="approval-popup">
      <div className="w-full max-w-lg rounded-2xl border border-amber-400/40 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Needs your OK{queue.length > 1 ? ` · 1 of ${queue.length}` : ''}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{isEmail ? 'Send this email?' : cur.label}</h2>
            {cur.deal && <p className="text-sm text-slate-400">{cur.deal.fileNumber ? `${cur.deal.fileNumber} · ` : ''}{cur.deal.address}{href && <> · <Link href={href} className="text-blue-300 hover:text-blue-200" onClick={snooze}>Open</Link></>}</p>}
          </div>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
          {isEmail && <p className="text-sm text-slate-300"><span className="text-slate-500">To </span>{to.length ? to.join(', ') : 'nobody'}</p>}
          {editing ? (
            <>
              {isEmail && <input aria-label="Subject" className={field} defaultValue={subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />}
              <textarea aria-label="Message" rows={8} className={field} defaultValue={message} onChange={(e) => setDraft((d) => ({ ...d, ...(isEmail ? { message: e.target.value } : { text: e.target.value }) }))} />
            </>
          ) : (
            <>
              {isEmail && <p className="text-sm font-medium text-white">{subject}</p>}
              <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm text-slate-200">{message || cur.summary}</p>
            </>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-amber-300">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={snooze} className="text-sm text-slate-400 hover:text-slate-200">Later</button>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void decide('reject')} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-100 hover:bg-white/5 disabled:opacity-60" data-testid="popup-reject">Reject</button>
            {!editing && <button type="button" disabled={busy} onClick={() => { setDraft({}); setEditing(true); }} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-100 hover:bg-white/5 disabled:opacity-60">Edit</button>}
            <button type="button" disabled={busy} onClick={() => void decide('approve')} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-60" data-testid="popup-approve">{editing ? 'Save and send' : isEmail ? 'Approve and send' : 'Approve'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
