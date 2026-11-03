'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { MERGE_FIELDS } from '@/lib/templateMerge';

interface TemplateRow {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  states: string[];
}

interface Recipient {
  name: string;
  email: string | null;
  role: string;
  category: string;
}

interface Rendered {
  kind: 'email' | 'letter' | 'form';
  name: string;
  subject: string;
  body: string;
  missing: string[];
  fileName: string | null;
  dealState: string | null;
  fitsState: boolean;
  recipients: Recipient[];
}

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none';
const kindLabel = { email: 'Email', letter: 'Letter', form: 'Form' } as const;
const missingLabel = (key: string) => MERGE_FIELDS.find((f) => f.key === key)?.label.toLowerCase() ?? key;

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

// Pick one of your templates for this deal, check the filled-in text, then send it, save it as a PDF in the deal's
// Documents, or copy your form into the Documents.
export default function UseTemplateModal({
  transactionId,
  dealState,
  onClose,
  onDocumentAdded,
}: {
  transactionId: string;
  dealState: string | null;
  onClose: () => void;
  onDocumentAdded: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<TemplateRow | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/templates${dealState ? `?state=${dealState}` : ''}`);
      if (cancelled) return;
      if (!res.ok) return setError(await readError(res, 'Could not load your templates'));
      setTemplates((await res.json()) as TemplateRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [dealState]);

  const choose = async (t: TemplateRow, recipientEmail?: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`/api/templates/${t.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, recipientEmail }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not fill in the template'));
      const r = (await res.json()) as Rendered;
      setPicked(t);
      setRendered(r);
      setSubject(r.subject);
      setBody(r.body);
      if (!recipientEmail) {
        const clients = r.recipients.filter((p) => p.category === 'Buyer' || p.category === 'Seller').map((p) => p.email!);
        setChosen(clients.slice(0, 1));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fill in the template');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (email: string) => setChosen((cur) => (cur.includes(email) ? cur.filter((x) => x !== email) : [...cur, email]));

  // Switching the first person ticked re-fills the greeting for them.
  const retarget = (email: string) => {
    toggle(email);
    if (picked && chosen.length === 0) void choose(picked, email);
  };

  const act = async (action: 'send' | 'save_pdf' | 'attach_form') => {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      const to = [...chosen, ...extra.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)];
      const res = await authFetch(`/api/templates/${picked.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, action, subject, body, to }),
      });
      if (!res.ok) throw new Error(await readError(res, 'That did not work'));
      const data = (await res.json()) as { mode?: string };
      if (action === 'send') setDone(data.mode === 'outbox' ? 'Saved to the test outbox (nothing was really sent on this machine).' : `Sent to ${to.length} ${to.length === 1 ? 'person' : 'people'}. A copy is in your inbox.`);
      else {
        setDone(action === 'save_pdf' ? 'Saved as a PDF in this deal’s Documents.' : 'Added to this deal’s Documents.');
        onDocumentAdded();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => (templates ?? []).filter((t) => (q ? `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q.toLowerCase()) : true)), [templates, q]);
  const withEmail = rendered?.recipients.filter((p) => p.email) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl p-5 md:p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">{picked ? picked.name : 'Use a template'}</h2>
            <p className="text-xs text-slate-400">
              {picked ? 'Check the text, then choose what to do with it.' : dealState ? `Showing templates for ${dealState} and every state.` : 'Pick a template. Set the deal’s state to see only the ones for that state.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 text-sm">
            Close
          </button>
        </div>

        {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-3">{error}</div>}

        {done ? (
          <div className="space-y-4">
            <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">{done}</div>
            <button type="button" onClick={onClose} className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl">
              Done
            </button>
          </div>
        ) : !picked || !rendered ? (
          <div className="space-y-3">
            <input className={inputCls} placeholder="Search your templates" value={q} onChange={(e) => setQ(e.target.value)} />
            {templates === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-slate-400">
                {templates.length === 0 ? 'You have no templates yet. Add the starter pack or make your own on the Templates page.' : 'Nothing matches.'}
              </p>
            ) : (
              <div className="grid gap-2 max-h-[50vh] overflow-y-auto pr-1">
                {shown.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => choose(t)}
                    className="text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-xl p-3 transition disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-100 font-medium truncate">{t.name}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border bg-blue-500/20 text-blue-300 border-blue-500/40 shrink-0">{kindLabel[t.kind]}</span>
                    </div>
                    {t.description && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{t.description}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!rendered.fitsState && <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">This template is for other states than {rendered.dealState}. Check it suits this deal.</div>}
            {rendered.missing.length > 0 && rendered.kind !== 'form' && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                This deal has no {rendered.missing.map(missingLabel).join(', ')} yet, so it was left blank below. Fill it in before using this.
              </div>
            )}

            {rendered.kind === 'email' && (
              <>
                <div>
                  <p className="text-xs text-slate-400 mb-1">To</p>
                  {withEmail.length === 0 ? (
                    <p className="text-xs text-slate-500">No one on this deal has an email address yet. Type one below.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {withEmail.map((p) => (
                        <label key={p.email} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${chosen.includes(p.email!) ? 'border-blue-500 bg-blue-500/10 text-slate-100' : 'border-white/10 text-slate-300'}`}>
                          <input type="checkbox" checked={chosen.includes(p.email!)} onChange={() => retarget(p.email!)} />
                          <span>
                            {p.name || p.email} <span className="text-slate-500">· {p.role || p.category}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  <input className={`${inputCls} mt-2`} placeholder="Another address (optional)" value={extra} onChange={(e) => setExtra(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Subject</label>
                  <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
                </div>
              </>
            )}
            {rendered.kind === 'letter' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Heading on the PDF (optional)</label>
                <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
              </div>
            )}
            {rendered.kind !== 'form' ? (
              <div>
                <label className="block text-xs text-slate-400 mb-1">{rendered.kind === 'email' ? 'Message' : 'Letter'}</label>
                <textarea className={`${inputCls} min-h-[220px] leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
              </div>
            ) : (
              <p className="text-sm text-slate-300">{rendered.fileName ? `Your file “${rendered.fileName}” will be copied into this deal’s Documents.` : 'This form template has no file yet. Upload one on the Templates page.'}</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {rendered.kind === 'email' && (
                <button type="button" disabled={busy || (chosen.length === 0 && !extra.trim()) || !subject.trim() || !body.trim()} onClick={() => act('send')} className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                  {busy ? 'Sending…' : 'Send email'}
                </button>
              )}
              {rendered.kind === 'letter' && (
                <button type="button" disabled={busy || !body.trim()} onClick={() => act('save_pdf')} className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save as PDF in Documents'}
                </button>
              )}
              {rendered.kind === 'form' && (
                <button type="button" disabled={busy || !rendered.fileName} onClick={() => act('attach_form')} className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                  {busy ? 'Adding…' : 'Add to Documents'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setRendered(null);
                }}
                className="px-4 py-2.5 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl"
              >
                Choose a different template
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
