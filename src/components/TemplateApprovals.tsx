'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { describeRule } from '@/components/TemplateRules';

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
  rule: { trigger_event: 'deal_closed' | 'closing_date' | 'acceptance_date'; offset_days: number; repeat_yearly: boolean; repeat_years: number; recipient_roles: string[] } | null;
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
const btnPrimary = 'px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition';
const btnGhost = 'px-4 py-2 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl disabled:opacity-50 transition';

async function readError(res: Response, fallback: string) {
  return (((await res.json().catch(() => ({}))) as { error?: string }).error) || fallback;
}

const formatDue = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function HowItWorks() {
  const steps = [
    { n: '1', title: 'You set a rule', text: 'Open any email or document template and add a rule, like “7 days after closing” or “every year on the closing anniversary”.' },
    { n: '2', title: 'Relay writes the draft', text: 'When that day comes, Relay fills the template in for that deal, with the client’s name, the address and the dates, and puts it here.' },
    { n: '3', title: 'You decide', text: 'Read it, change anything you like, then approve it or skip it. Nothing is ever sent or saved without your click.' },
  ];
  return (
    <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 md:p-5">
      <h2 className="text-base font-semibold text-slate-100">What is Approvals?</h2>
      <p className="text-sm text-slate-300 mt-1">
        It is where automatic drafts wait for you. Instead of Relay sending things on its own, it prepares them and asks first, so you stay in control of everything that goes out under your name.
      </p>
      <ol className="grid md:grid-cols-3 gap-3 mt-4">
        {steps.map((s) => (
          <li key={s.n} className="bg-slate-900/40 border border-white/10 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">{s.n}</span>
              <span className="text-sm font-semibold text-slate-100">{s.title}</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="grid sm:grid-cols-3 gap-3 mt-4 text-xs text-slate-400">
        <p>
          <span className="font-semibold text-slate-200">Approve</span> on an email sends it under your name. Replies land in the deal’s inbox so they stay with the file.
        </p>
        <p>
          <span className="font-semibold text-slate-200">Approve</span> on a letter or form saves it into that deal’s Documents.
        </p>
        <p>
          <span className="font-semibold text-slate-200">Skip</span> throws the draft away. Nothing is sent. Emails can only go to people already on the deal.
        </p>
      </div>
    </div>
  );
}

// Drafts made by automatic rules, waiting for you.
export default function TemplateApprovals({ onChanged, onGoToTemplates }: { onChanged: () => void; onGoToTemplates: (section: 'documents' | 'emails') => void }) {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [rules, setRules] = useState({ total: 0, enabled: 0 });
  const [outboxOnly, setOutboxOnly] = useState(false);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showHelp, setShowHelp] = useState<boolean | null>(null); // null = decide once we know what is here

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/template-runs?status=${status}`);
      if (cancelled) return;
      if (!res.ok) return setError(await readError(res, 'Could not load your drafts'));
      const data = (await res.json()) as { runs: Run[]; outboxOnly: boolean; rules: { total: number; enabled: number } };
      setRuns(data.runs);
      setRules(data.rules);
      setOutboxOnly(data.outboxOnly);
      setShowHelp((cur) => (cur === null ? data.rules.enabled === 0 || data.runs.length === 0 : cur));
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

  const what = (r: Run) => (r.kind === 'email' ? 'Email' : r.kind === 'letter' ? 'Letter' : 'Form');
  const historyLabel = (r: Run) => (r.status === 'sent' ? (r.kind === 'email' ? 'Sent' : 'Saved to Documents') : r.status === 'dismissed' ? 'Skipped' : r.status === 'failed' ? 'Did not work' : 'Waiting');

  const pendingCount = runs?.filter((r) => r.status === 'pending').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-400">
          {rules.enabled === 0 ? 'No automatic rules are switched on.' : `${rules.enabled} automatic rule${rules.enabled === 1 ? ' is' : 's are'} on.`}{' '}
          <button type="button" className="text-blue-300 hover:text-blue-200 underline" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? 'Hide the explanation' : 'How does this work?'}
          </button>
        </div>
        <select className="bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm" value={status} onChange={(e) => setStatus(e.target.value as 'pending' | 'all')} aria-label="Which drafts">
          <option value="pending">Waiting for me</option>
          <option value="all">Everything, including past ones</option>
        </select>
      </div>

      {showHelp && <HowItWorks />}
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}

      {runs === null ? (
        <div className="text-slate-400">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8 text-center">
          {rules.total === 0 ? (
            <>
              <p className="text-slate-100 font-semibold mb-1">You haven’t set up any automatic drafts yet</p>
              <p className="text-sm text-slate-400 max-w-lg mx-auto mb-4">Pick a template, add a rule such as “7 days after closing”, and the drafts will show up here for you to approve. The starter templates come with suggested rules already added but switched off.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={btnPrimary} onClick={() => onGoToTemplates('emails')}>
                  Go to email templates
                </button>
                <button type="button" className={btnGhost} onClick={() => onGoToTemplates('documents')}>
                  Go to documents
                </button>
              </div>
            </>
          ) : rules.enabled === 0 ? (
            <>
              <p className="text-slate-100 font-semibold mb-1">Your rules are all switched off</p>
              <p className="text-sm text-slate-400 max-w-lg mx-auto mb-4">Open a template and flip a rule to On. Nothing is drafted for a rule that is off.</p>
              <button type="button" className={btnPrimary} onClick={() => onGoToTemplates('emails')}>
                Go to email templates
              </button>
            </>
          ) : (
            <>
              <p className="text-slate-100 font-semibold mb-1">You’re all caught up</p>
              <p className="text-sm text-slate-400 max-w-lg mx-auto">Nothing is waiting for you. A new draft appears here when a deal closes or a date passes that one of your rules is watching.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {status === 'pending' && pendingCount > 0 && <p className="text-sm text-slate-300">{pendingCount} draft{pendingCount === 1 ? ' is' : 's are'} waiting for you. Nothing has been sent yet.</p>}
          {runs.map((r) => {
            const edit = edits[r.id] ?? { subject: r.subject ?? '', body: r.body ?? '' };
            const isOpen = open === r.id;
            const who = r.recipients.map((p) => p.name || p.email).join(', ');
            return (
              <div key={r.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-300">{what(r)} draft</div>
                    <div className="text-slate-100 font-semibold break-words">{r.template_name ?? 'Deleted template'}</div>
                    <div className="text-sm text-slate-400 mt-0.5 break-words">
                      For{' '}
                      {r.deal ? (
                        <Link href={`/dashboard/transactions/${r.transaction_id}`} className="text-blue-300 hover:text-blue-200">
                          {r.deal.property_address} ({r.deal.file_number})
                        </Link>
                      ) : (
                        'a deal that was removed'
                      )}
                    </div>
                  </div>
                  {r.status !== 'pending' && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${r.status === 'sent' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : r.status === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10' : 'text-slate-300 border-slate-600'}`}>{historyLabel(r)}</span>
                  )}
                </div>

                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
                  {r.rule && (
                    <div className="sm:col-span-2 flex gap-2">
                      <dt className="text-slate-500 shrink-0">Why you’re seeing this</dt>
                      <dd className="text-slate-300">Your rule: {describeRule(r.rule)} (due {formatDue(r.due_on)})</dd>
                    </div>
                  )}
                  {r.kind === 'email' && (
                    <div className="sm:col-span-2 flex gap-2">
                      <dt className="text-slate-500 shrink-0">Goes to</dt>
                      <dd className={r.recipients.length ? 'text-slate-300' : 'text-amber-300'}>
                        {r.recipients.length ? who : 'nobody yet. Add an email address to a contact on the deal, then come back.'}
                      </dd>
                    </div>
                  )}
                </dl>
                {r.error && <div className="text-sm text-red-300 mt-2">{r.error}</div>}

                {r.status === 'pending' && (
                  <>
                    {r.kind !== 'form' && (
                      <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="text-sm text-blue-300 hover:text-blue-200 mt-3">
                        {isOpen ? 'Hide the draft' : 'Read or edit the draft'}
                      </button>
                    )}
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        {r.kind === 'email' && <input className={inputCls} value={edit.subject} onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, subject: e.target.value } })} aria-label="Subject" />}
                        <textarea className={`${inputCls} min-h-[180px] leading-relaxed`} value={edit.body} onChange={(e) => setEdits({ ...edits, [r.id]: { ...edit, body: e.target.value } })} aria-label="Message" />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      <button type="button" disabled={busy === r.id || (r.kind === 'email' && r.recipients.length === 0)} onClick={() => decide(r, 'approve')} className={btnPrimary}>
                        {busy === r.id ? 'Working…' : r.kind === 'email' ? 'Approve and send' : r.kind === 'letter' ? 'Approve and save to Documents' : 'Approve and add to Documents'}
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => decide(r, 'dismiss')} className={btnGhost}>
                        Skip this one
                      </button>
                      <span className="text-xs text-slate-500 w-full sm:w-auto">{r.kind === 'email' ? 'Sends now under your name.' : 'Saved into this deal’s Documents.'} Skipping sends nothing.</span>
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
          <div className="text-sm font-semibold text-amber-200 mb-1">Test outbox (this computer only)</div>
          <p className="text-xs text-slate-400 mb-3">While you test, nothing is really sent. Emails you approve are recorded here instead, so you can check how they would look.</p>
          {outbox.length === 0 ? (
            <p className="text-xs text-slate-500">Empty.</p>
          ) : (
            <ul className="space-y-2">
              {outbox.map((o) => (
                <li key={o.id} className="text-xs text-slate-300 bg-slate-800/50 rounded-lg px-3 py-2">
                  <div className="font-medium text-slate-100 break-words">{o.subject}</div>
                  <div className="text-slate-400 break-words">To {o.to_emails.join(', ')} · {new Date(o.created_at).toLocaleString()}</div>
                  <div className="whitespace-pre-wrap mt-1 text-slate-300 break-words">{o.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
