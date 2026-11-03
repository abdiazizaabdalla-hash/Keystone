'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { MERGE_FIELDS } from '@/lib/templateMerge';
import { US_STATES } from '@/lib/usStates';
import TemplateRules from '@/components/TemplateRules';
import TemplateApprovals from '@/components/TemplateApprovals';
import DocumentsLibrary from '@/components/DocumentsLibrary';

type Kind = 'email' | 'letter' | 'form';
type Section = 'documents' | 'emails';

interface Template {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  category: string;
  states: string[];
  subject: string | null;
  body: string | null;
  file_name: string | null;
  file_size: number | null;
  archived: boolean;
  last_used_at?: string | null;
}

interface Starter {
  key: string;
  kind: string;
  name: string;
  installed: boolean;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'welcome', label: 'Welcome' },
  { value: 'offer', label: 'Offer' },
  { value: 'listing', label: 'Listing' },
  { value: 'disclosure', label: 'Disclosure' },
  { value: 'closing', label: 'Closing' },
  { value: 'post_closing', label: 'After closing' },
];
const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;
const KIND_LABEL: Record<Kind, string> = { email: 'Email', letter: 'Letter', form: 'Form' };
const sectionOf = (k: Kind): Section => (k === 'email' ? 'emails' : 'documents');

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none';
const btnPrimary = 'px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition whitespace-nowrap disabled:opacity-50';
const btnGhost = 'px-4 py-2.5 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl transition whitespace-nowrap disabled:opacity-50';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5';

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export default function TemplatesPage() {
  const enabled = isFeatureOnClient('templates');
  const [view, setView] = useState<Section | 'approvals'>('documents');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [counts, setCounts] = useState({ documents: 0, emails: 0 });
  const [starters, setStarters] = useState<Starter[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [docType, setDocType] = useState<'' | 'letter' | 'form'>('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Template | { new: Kind } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [installing, setInstalling] = useState(false);

  const section: Section = view === 'emails' ? 'emails' : 'documents';

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('kinds', section === 'emails' ? 'email' : docType || 'letter,form');
        if (state) params.set('state', state);
        if (category) params.set('category', category);
        if (q.trim()) params.set('q', q.trim());
        if (showArchived) params.set('archived', '1');
        const [tRes, sRes, pRes, allRes] = await Promise.all([
          authFetch(`/api/templates?${params}`),
          authFetch('/api/templates/starters'),
          authFetch('/api/template-runs?status=pending'),
          authFetch('/api/templates'),
        ]);
        if (!tRes.ok) throw new Error(await readError(tRes, 'Failed to load templates'));
        const t = (await tRes.json()) as Template[];
        const s = sRes.ok ? ((await sRes.json()) as Starter[]) : [];
        const pendingCount = pRes.ok ? ((await pRes.json()) as { runs: unknown[] }).runs.length : 0;
        const all = allRes.ok ? ((await allRes.json()) as Template[]) : [];
        if (!cancelled) {
          setTemplates(t);
          setStarters(s);
          setPending(pendingCount);
          setCounts({ documents: all.filter((x) => x.kind !== 'email').length, emails: all.filter((x) => x.kind === 'email').length });
          setError(null);
        }
      } catch (e) {
        if (!cancelled && !(e instanceof AuthRequiredError)) setError(e instanceof Error ? e.message : 'Failed to load templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, section, state, docType, category, q, showArchived, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const missingStarters = starters.filter((s) => !s.installed && (section === 'emails' ? s.kind === 'email' : s.kind !== 'email'));

  const installStarters = async () => {
    setInstalling(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/templates/starters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: missingStarters.map((s) => s.key) }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not add the starter templates'));
      const { added } = (await res.json()) as { added: number };
      setNotice(added > 0 ? `Added ${added} starter ${section === 'emails' ? 'email' : 'document'}${added === 1 ? '' : 's'}. Edit any of them freely.` : 'You already have all the starters.');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the starter templates');
    } finally {
      setInstalling(false);
    }
  };

  if (!enabled) return <div className="p-6 text-slate-400">Templates are not available yet.</div>;

  const wrap = (children: React.ReactNode) => (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-10">
      <div className="max-w-6xl mx-auto">{children}</div>
    </div>
  );

  if (editing) {
    return wrap(
      <TemplateEditor
        template={'id' in editing ? editing : null}
        startKind={'new' in editing ? editing.new : 'letter'}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setNotice(message);
          reload();
        }}
      />
    );
  }

  const tabs: { id: Section | 'approvals'; label: string; sub: string; count: number | null; alert?: boolean }[] = [
    { id: 'documents', label: 'Documents', sub: 'Letters and your own forms', count: counts.documents },
    { id: 'emails', label: 'Emails', sub: 'Messages you send from a deal', count: counts.emails },
    { id: 'approvals', label: 'Approvals', sub: 'Drafts waiting for your OK', count: pending, alert: pending > 0 },
  ];

  return wrap(
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl md:text-4xl font-semibold text-slate-100 mb-1">Templates</h1>
        <p className="text-sm text-slate-400 max-w-2xl">Save the documents and emails you use again and again. They fill in the client, address and dates for you.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 p-1 bg-white/5 border border-white/10 rounded-2xl" role="tablist" aria-label="Templates">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            onClick={() => {
              setView(t.id);
              setNotice(null);
              setCategory('');
              setQ('');
            }}
            className={`rounded-xl px-4 py-2.5 text-left transition ${view === t.id ? 'bg-blue-500 text-white shadow' : 'text-slate-300 hover:bg-white/10'}`}
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              {t.label}
              {t.count !== null && (
                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${t.alert ? 'bg-amber-400 text-slate-900' : view === t.id ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-300'}`}>{t.count}</span>
              )}
            </span>
            <span className={`block text-xs ${view === t.id ? 'text-blue-100' : 'text-slate-500'}`}>{t.sub}</span>
          </button>
        ))}
      </div>

      {notice && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">{notice}</div>}
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}

      {view === 'approvals' ? (
        <TemplateApprovals onChanged={reload} onGoToTemplates={(s) => setView(s)} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-slate-400 max-w-2xl">
              {section === 'documents'
                ? 'Letters you write once and save as a PDF, plus your own state forms (PDF or Word) that you keep here. Add either to a deal’s Documents with one click, and tag each one with the states it is for.'
                : 'Emails you send again and again, like “congratulations on closing”. Pick one on a deal, check it, and send. You can also set it to draft itself automatically (see the Approvals tab).'}
            </p>
            <div className="flex gap-2 shrink-0">
              {missingStarters.length > 0 && (
                <button type="button" className={btnGhost} onClick={installStarters} disabled={installing}>
                  {installing ? 'Adding…' : `Add starter ${section === 'emails' ? 'emails' : 'letters'} (${missingStarters.length})`}
                </button>
              )}
              {section === 'documents' ? (
                <>
                  <button type="button" className={btnGhost} onClick={() => setEditing({ new: 'form' })}>
                    Upload a form
                  </button>
                  <button type="button" className={btnPrimary} onClick={() => setEditing({ new: 'letter' })}>
                    New letter
                  </button>
                </>
              ) : (
                <button type="button" className={btnPrimary} onClick={() => setEditing({ new: 'email' })}>
                  New email
                </button>
              )}
            </div>
          </div>

          {section === 'documents' ? (
            <DocumentsLibrary reloadKey={reloadKey} showArchived={showArchived} onEdit={(t) => setEditing(t as Template)} />
          ) : (
            <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
              <option value="">All states</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">Every category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input className={`${inputCls} sm:col-span-2`} placeholder={`Search ${section}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {state && <p className="text-xs text-slate-500 -mt-2">Showing {US_STATES.find((s) => s.code === state)?.name} templates and the General ones that work in any state.</p>}

          {loading ? (
            <div className="text-slate-400">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <p className="text-slate-200 font-semibold mb-1">{q || state || category ? 'Nothing matches those filters.' : 'No email templates yet.'}</p>
              <p className="text-sm text-slate-400 mb-4 max-w-md mx-auto">
                {missingStarters.length > 0 ? 'Start with the starter emails: friendly after-closing messages you can rewrite.' : 'Write your first email template.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {missingStarters.length > 0 && (
                  <button type="button" className={btnPrimary} onClick={installStarters} disabled={installing}>
                    Add the starter emails
                  </button>
                )}
                <button type="button" className={btnGhost} onClick={() => setEditing({ new: 'email' })}>
                  New email
                </button>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => setEditing(t)} className="text-left bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-4 transition min-w-0 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-slate-100 font-semibold truncate">{t.name}</div>
                      {t.description && <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{t.description}</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-3 text-xs">
                    <span className="text-slate-400">{categoryLabel(t.category)}</span>
                    <span className="text-slate-600">·</span>
                    {t.states.length === 0 ? (
                      <span className="text-slate-400">General</span>
                    ) : (
                      t.states.slice(0, 5).map((s) => (
                        <span key={s} className="px-1.5 py-0.5 rounded bg-slate-700/70 text-slate-200">
                          {s}
                        </span>
                      ))
                    )}
                    {t.states.length > 5 && <span className="text-slate-500">+{t.states.length - 5}</span>}
                    {t.kind === 'form' && <span className={`truncate max-w-full ${t.file_name ? 'text-emerald-300' : 'text-amber-300'}`}>{t.file_name ? `· ${t.file_name}` : '· no file yet'}</span>}
                    {t.archived && <span className="text-amber-300">· archived</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

            </>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </>
      )}
    </div>
  );
}

function TemplateEditor({ template, startKind, onClose, onSaved }: { template: Template | null; startKind: Kind; onClose: () => void; onSaved: (message: string) => void }) {
  const [saved, setSaved] = useState<Template | null>(template);
  const [kind, setKind] = useState<Kind>(template?.kind ?? startKind);
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [category, setCategory] = useState(template?.category ?? 'general');
  const [states, setStates] = useState<string[]>(template?.states ?? []);
  const [pickStates, setPickStates] = useState(false);
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocus, setLastFocus] = useState<'subject' | 'body'>('body');
  const fileRef = useRef<HTMLInputElement>(null);
  const section = sectionOf(kind);

  const insertField = (key: string) => {
    const token = `{{${key}}}`;
    if (lastFocus === 'subject' && kind === 'email' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const toggleState = (code: string) => setStates((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  const save = async (): Promise<Template | null> => {
    setBusy(true);
    setError(null);
    try {
      const payload = { kind, name, description, category, states, subject: kind === 'email' ? subject : '', body: kind === 'form' ? '' : body };
      const res = await authFetch(saved ? `/api/templates/${saved.id}` : '/api/templates', {
        method: saved ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not save the template'));
      const row = (await res.json()) as Template;
      setSaved(row);
      return row;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the template');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    const row = saved ?? (await save());
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch(`/api/templates/${row.id}/file`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await readError(res, 'Upload failed'));
      setSaved((await res.json()) as Template);
      setNote('File uploaded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openFile = async () => {
    if (!saved) return;
    const res = await authFetch(`/api/templates/${saved.id}/file`);
    if (!res.ok) return setError(await readError(res, 'Could not open the file'));
    const { url } = (await res.json()) as { url: string | null };
    if (url) window.open(url, '_blank', 'noopener');
  };

  const archive = async () => {
    if (!saved) return;
    setBusy(true);
    const res = await authFetch(`/api/templates/${saved.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: !saved.archived }) });
    setBusy(false);
    if (!res.ok) return setError(await readError(res, 'Could not update the template'));
    onSaved(saved.archived ? 'Template restored.' : 'Template archived.');
  };

  const remove = async () => {
    if (!saved || !window.confirm(`Delete “${saved.name}”? This cannot be undone.`)) return;
    setBusy(true);
    const res = await authFetch(`/api/templates/${saved.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return setError(await readError(res, 'Could not delete the template'));
    onSaved('Template deleted.');
  };

  const title = `${saved ? 'Edit' : 'New'} ${kind === 'email' ? 'email' : kind === 'form' ? 'form' : 'letter'}`;

  return (
    <div className="space-y-5">
      <button type="button" className="text-sm text-slate-400 hover:text-slate-200" onClick={onClose}>
        ← Back to {section === 'emails' ? 'emails' : 'documents'}
      </button>
      <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">{title}</h1>

      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}
      {note && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">{note}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Main column: the words */}
        <div className="space-y-4 min-w-0">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={140} placeholder={kind === 'email' ? 'e.g. Thank you after closing' : kind === 'form' ? 'e.g. Texas residential contract' : 'e.g. Closing summary letter'} />
          </div>

          {section === 'documents' && (
            <div className="inline-flex p-1 bg-white/5 border border-white/10 rounded-xl text-sm" role="tablist" aria-label="Kind of document">
              {(['letter', 'form'] as const).map((k) => (
                <button key={k} type="button" disabled={!!saved} onClick={() => setKind(k)} className={`px-4 py-1.5 rounded-lg transition disabled:cursor-default ${kind === k ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/10 disabled:hover:bg-transparent'}`}>
                  {k === 'letter' ? 'A letter I write here' : 'My own form file'}
                </button>
              ))}
            </div>
          )}

          {kind === 'email' && (
            <div>
              <label className={labelCls}>Subject</label>
              <input ref={subjectRef} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => setLastFocus('subject')} maxLength={200} />
            </div>
          )}

          {kind !== 'form' && (
            <div>
              <label className={labelCls}>{kind === 'email' ? 'Message' : 'Letter text'}</label>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-xs text-slate-500 mr-1">Fill in automatically:</span>
                {MERGE_FIELDS.map((f) => (
                  <button key={f.key} type="button" onClick={() => insertField(f.key)} className="px-2 py-1 rounded-lg text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200" title={`Inserts {{${f.key}}}`}>
                    + {f.label}
                  </button>
                ))}
              </div>
              <textarea ref={bodyRef} className={`${inputCls} min-h-[300px] lg:min-h-[380px] font-mono leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} onFocus={() => setLastFocus('body')} maxLength={20000} />
              <p className="text-xs text-slate-500 mt-1">Tap a button to put a field like {'{{client_first_name}}'} where your cursor is. It is replaced with the real name, address or date when you use the template on a deal.</p>
            </div>
          )}

          {kind === 'form' && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="text-sm font-semibold text-slate-200 mb-1">Your form file</div>
              <p className="text-xs text-slate-400 mb-3">Upload the PDF or Word form you are licensed to use. Relay keeps it here and copies it into a deal’s Documents when you pick it. Relay does not supply state legal forms.</p>
              {saved?.file_name && (
                <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
                  <button type="button" className="text-blue-300 hover:text-blue-200 underline break-all text-left" onClick={openFile}>
                    {saved.file_name}
                  </button>
                  {saved.file_size ? <span className="text-xs text-slate-500">{(saved.file_size / 1024 / 1024).toFixed(1)} MB</span> : null}
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={busy || !name.trim()}
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                className="text-sm text-slate-300 max-w-full"
              />
              {!name.trim() && <p className="text-xs text-amber-300 mt-2">Give the form a name first.</p>}
            </div>
          )}
        </div>

        {/* Side column: where it applies, and automation */}
        <div className="space-y-4 min-w-0">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
            <div>
              <label className={labelCls}>Category</label>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Short note (only you see this)</label>
              <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">States</label>
                <button type="button" onClick={() => setPickStates((v) => !v)} className="text-xs text-blue-300 hover:text-blue-200">
                  {pickStates ? 'Done' : 'Choose'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {states.length === 0 ? <span className="text-sm text-slate-300">General</span> : states.map((s) => (
                  <span key={s} className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-200 text-xs">
                    {s}
                  </span>
                ))}
              </div>
              {pickStates && (
                <div className="mt-2 grid grid-cols-6 gap-1 max-h-48 overflow-y-auto bg-slate-800/40 border border-white/10 rounded-lg p-2">
                  {US_STATES.map((s) => (
                    <button key={s.code} type="button" title={s.name} onClick={() => toggleState(s.code)} className={`py-1 rounded text-xs transition ${states.includes(s.code) ? 'bg-blue-500 text-white' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'}`}>
                      {s.code}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1.5">
                {states.length === 0 ? 'Shown on every deal. Pick states to show it only on deals in those states.' : (
                  <>
                    Shown on deals in {states.join(', ')}.{' '}
                    <button type="button" className="text-slate-400 hover:text-slate-200 underline" onClick={() => setStates([])}>
                      Use as General (any state)
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
          {saved ? (
            <TemplateRules templateId={saved.id} />
          ) : (
            <p className="text-xs text-slate-500 bg-white/5 border border-white/10 rounded-2xl p-4">After you save, you can set this to draft itself automatically (for example, a week after closing).</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !name.trim()}
          onClick={async () => {
            const row = await save();
            if (row) onSaved('Saved.');
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={btnGhost} onClick={onClose}>
          Cancel
        </button>
        {saved && (
          <>
            <button type="button" className={`${btnGhost} sm:ml-auto`} onClick={archive} disabled={busy}>
              {saved.archived ? 'Restore' : 'Archive'}
            </button>
            <button type="button" className="px-4 py-2 text-red-300 hover:text-red-200 text-sm rounded-xl disabled:opacity-50" onClick={remove} disabled={busy}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
