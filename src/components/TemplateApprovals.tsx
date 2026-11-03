'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

interface Run {
  id: string;
  transaction_id: string;
  kind: 'email' | 'letter' | 'form';
  status: 'pending' | 'sent' | 'dismissed' | 'failed';
  due_on: string;
  subject: string | null;
  body: string | null;
  recipients: Array<{ name: string; email: string; role: string }>;
  error: string | null;
  deal: { file_number: string; property_address: string } | null;
  template_name: string | null;
}

interface OutboxRow {
  id: string;
  to_emails: string[];
  subject: string;
  body: string;
  source: string;
  created_at: string;
}

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-blue-500 focus:outline-none';

async function readError(res: Response, fallback: string) {
  return (((await res.json().catch(() => ({}))) as { error?: string }).error) || fallback;
}

// Drafts made by automatic rules, waiting for you. Approve sends the email (or saves the letter / form to the deal's
// Documents); Dismiss throws it away. Nothing happens without a click here.
export default function TemplateApprovals({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [outboxOnly, setOutboxOnly] = useState(false);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/template-runs?status=${status}`);
      if (cancelled) return;
      if (!res.ok) return setError(await readError(res, 'Could not load your drafts'));
      const data = (await res.json()) as { runs: Run[]; outboxOnly: boolean };
      setRuns(data.runs);
      setOutboxOnly(data.outboxOnly);
      if (data.outboxOnly) {
        const o = await authFetch('/api/template-runs/outbox');
        if (!cancelled && o.ok) setOutbox((await o.json()) as OutboxRow[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, reloadKey]);

  const decide = async (run: Run, action: 'approve' | 'dismiss') => {
    setBusy(run.id);
    setError('');
    try {
      const edit = edits[run.id];
      const res = await authFetch(`/api/template-runs/${run.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(edit ? { subject: edit.subject, body: edit.body } : {}) }),
      });
      if (!res.ok) throw new Error(await readError(res, 'That did not work'));
      setOpen(null);
      setReloadKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  const verb = (r: Run) => (r.kind === 'email' ? 'Approve and send' : r.kind === 'letter' ? 'Approve and save PDF' : 'Approve and add form');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400 max-w-2xl">Drafts your automatic rules have written. Read them, change anything you like, then approve. Nothing goes out on its own.</p>
        <select className="bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm" value={status} onChange={(e) => setStatus(e.target.value as 'pending' | 'all')}>
          <option value="pending">Waiting for me</option>
          <option value="all">Everything</option>
        </select>
      </div>
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}
      {runs === null ? (
        <div className="text-slate-400">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-400 text-sm">Nothing waiting. Drafts show up here when a deal closes or a date passes that one of your rules is watching for.</div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => {
            const edit = edits[r.id] ?? { subject: r.subject ?? '', body: r.body ?? '' };
            const isOpen = open === r.id;
            return (
              <div key={r.id} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-100 font-semibold truncate">{r.template_name ?? 'Deleted template'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {r.deal ? (
                        <Link href={`/dashboard/transactions/${r.transaction_id}`} className="text-blue-300 hover:text-blue-200">
                          {r.deal.file_number} · {r.deal.property_address}
                        </Link>
                      ) : (
                        'Deal removed'
                      )}{' '}
                      · due {r.due_on}
                      {r.kind === 'email' && ` · to ${r.recipients.length > 0 ? r.recipients.map((p) => p.name || p.email).join(', ') : 'nobody yet (add an email to a contact on the deal)'}`}
                    </div>
                  </div>
                  {r.status !== 'pending' && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border ${r.status === 'sent' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : r.status === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10' : 'text-slate-300 border-slate-600'}`}>{r.status}</span>
                  )}
                </div>
                {r.error && <div className="text-xs text-red-300 mt-1">{r.error}</div>}
                {r.status === 'pending' && (
                  <>
                    {r.kind !== 'form' && (
                      <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="text-xs text-slate-400 hover:text-slate-200 mt-2">
                        {isOpen ? 'Hide the draft' : 'Read or edit the draft'}
                      </button>
                    )}
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        <input className={inputCls} value={edit.subject} onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, subject: e.target.value } })} />
                        <textarea className={`${inputCls} min-h-[160px] leading-relaxed`} value={edit.body} onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, body: e.target.value } })} />
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button type="button" disabled={busy === r.id || (r.kind === 'email' && r.recipients.length === 0)} onClick={() => decide(r, 'approve')} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                        {busy === r.id ? 'Working…' : verb(r)}
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => decide(r, 'dismiss')} className="px-4 py-2 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl disabled:opacity-50">
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {outboxOnly && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
          <div className="text-sm font-semibold text-amber-200 mb-1">Test outbox (this machine only)</div>
          <p className="text-xs text-slate-400 mb-3">Nothing is really sent here. Emails you approve are recorded below instead, so you can check them.</p>
          {outbox.length === 0 ? (
            <p className="text-xs text-slate-500">Empty.</p>
          ) : (
            <ul className="space-y-2">
              {outbox.map((o) => (
                <li key={o.id} className="text-xs text-slate-300 bg-slate-800/50 rounded-lg px-3 py-2">
                  <div className="font-medium text-slate-100">{o.subject}</div>
                  <div className="text-slate-400">To {o.to_emails.join(', ')} · {o.source} · {new Date(o.created_at).toLocaleString()}</div>
                  <div className="whitespace-pre-wrap mt-1 text-slate-300">{o.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
