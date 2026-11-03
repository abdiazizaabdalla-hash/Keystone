'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { MERGE_FIELDS } from '@/lib/templateMerge';
import { US_STATES } from '@/lib/usStates';

interface Template {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  category: string;
  states: string[];
  subject: string | null;
  body: string | null;
  file_name: string | null;
  file_size: number | null;
  archived: boolean;
}

interface Starter {
  key: string;
  kind: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
}

const KINDS: { value: Template['kind']; label: string; hint: string }[] = [
  { value: 'email', label: 'Email', hint: 'A message to a client or agent' },
  { value: 'letter', label: 'Letter', hint: 'A document you print or save as PDF' },
  { value: 'form', label: 'Form', hint: 'Your own PDF or Word form, kept by state' },
];
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
const kindLabel = (v: string) => KINDS.find((k) => k.value === v)?.label ?? v;

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none';
const btnPrimary = 'px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition whitespace-nowrap disabled:opacity-50';
const btnGhost = 'px-4 py-2.5 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl transition whitespace-nowrap disabled:opacity-50';

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export default function TemplatesPage() {
  const enabled = isFeatureOnClient('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (state) params.set('state', state);
        if (kind) params.set('kind', kind);
        if (category) params.set('category', category);
        if (q.trim()) params.set('q', q.trim());
        if (showArchived) params.set('archived', '1');
        const [tRes, sRes] = await Promise.all([authFetch(`/api/templates?${params}`), authFetch('/api/templates/starters')]);
        if (!tRes.ok) throw new Error(await readError(tRes, 'Failed to load templates'));
        const t = (await tRes.json()) as Template[];
        const s = sRes.ok ? ((await sRes.json()) as Starter[]) : [];
        if (!cancelled) {
          setTemplates(t);
          setStarters(s);
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
  }, [enabled, state, kind, category, q, showArchived, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const missingStarters = starters.filter((s) => !s.installed).length;

  const installStarters = async () => {
    setInstalling(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/templates/starters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(await readError(res, 'Could not add the starter templates'));
      const { added } = (await res.json()) as { added: number };
      setNotice(added > 0 ? `Added ${added} starter template${added === 1 ? '' : 's'} to your library. Edit any of them freely.` : 'You already have all the starters.');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the starter templates');
    } finally {
      setInstalling(false);
    }
  };

  if (!enabled) {
    return <div className="text-slate-400">Templates are not available yet.</div>;
  }

  if (editing) {
    return (
      <TemplateEditor
        template={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setNotice(message);
          reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-slate-100 mb-1">Templates</h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Emails, letters and your own forms, kept by state. Use them on any deal and the client, address and dates fill in for you.
          </p>
        </div>
        <div className="flex gap-2">
          {missingStarters > 0 && (
            <button type="button" className={btnGhost} onClick={installStarters} disabled={installing}>
              {installing ? 'Adding…' : `Add starter pack (${missingStarters})`}
            </button>
          )}
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            New template
          </button>
        </div>
      </div>

      {notice && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">{notice}</div>}
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
          <option value="">All states</option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">Emails, letters and forms</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}s
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
        <input className={`${inputCls} lg:col-span-2`} placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {state && <p className="text-xs text-slate-500">Showing {US_STATES.find((s) => s.code === state)?.name} templates and the ones that work in every state.</p>}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-slate-200 font-semibold mb-1">{q || state || kind || category ? 'Nothing matches those filters.' : 'No templates yet.'}</p>
          <p className="text-sm text-slate-400 mb-4">
            {missingStarters > 0 ? 'Start with the starter pack: friendly after-closing emails and simple letters you can rewrite.' : 'Make one from scratch, or upload a form you already use.'}
          </p>
          <div className="flex justify-center gap-2">
            {missingStarters > 0 && (
              <button type="button" className={btnPrimary} onClick={installStarters} disabled={installing}>
                Add starter pack
              </button>
            )}
            <button type="button" className={btnGhost} onClick={() => setEditing('new')}>
              New template
            </button>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setEditing(t)}
              className="text-left bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-4 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-slate-100 font-semibold truncate">{t.name}</div>
                  {t.description && <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{t.description}</div>}
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border bg-blue-500/20 text-blue-300 border-blue-500/40 shrink-0">
                  {kindLabel(t.kind)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-3 text-xs">
                <span className="text-slate-400">{categoryLabel(t.category)}</span>
                <span className="text-slate-600">·</span>
                {t.states.length === 0 ? (
                  <span className="text-slate-400">Every state</span>
                ) : (
                  t.states.slice(0, 6).map((s) => (
                    <span key={s} className="px-1.5 py-0.5 rounded bg-slate-700/70 text-slate-200">
                      {s}
                    </span>
                  ))
                )}
                {t.states.length > 6 && <span className="text-slate-500">+{t.states.length - 6}</span>}
                {t.kind === 'form' && <span className={t.file_name ? 'text-emerald-300' : 'text-amber-300'}>{t.file_name ? `· ${t.file_name}` : '· no file yet'}</span>}
                {t.archived && <span className="text-amber-300">· archived</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived templates
      </label>
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [saved, setSaved] = useState<Template | null>(template);
  const [kind, setKind] = useState<Template['kind']>(template?.kind ?? 'email');
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [category, setCategory] = useState(template?.category ?? 'general');
  const [states, setStates] = useState<string[]>(template?.states ?? []);
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocus, setLastFocus] = useState<'subject' | 'body'>('body');
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="space-y-5 max-w-3xl">
      <button type="button" className="text-sm text-slate-400 hover:text-slate-200" onClick={onClose}>
        ← Back to templates
      </button>
      <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">{saved ? 'Edit template' : 'New template'}</h1>

      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>}
      {note && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">{note}</div>}

      <div className="grid sm:grid-cols-3 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={`text-left rounded-xl border p-3 transition ${kind === k.value ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:border-white/25'}`}
          >
            <div className="text-sm font-semibold text-slate-100">{k.label}</div>
            <div className="text-xs text-slate-400">{k.hint}</div>
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={140} placeholder="e.g. Thank you after closing" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Category</label>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Short description (only you see this)</label>
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs text-slate-400">States</label>
          {states.length > 0 && (
            <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setStates([])}>
              Clear (use in every state)
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto bg-slate-800/40 border border-white/10 rounded-lg p-2">
          {US_STATES.map((s) => (
            <button
              key={s.code}
              type="button"
              title={s.name}
              onClick={() => toggleState(s.code)}
              className={`px-2 py-1 rounded text-xs transition ${states.includes(s.code) ? 'bg-blue-500 text-white' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'}`}
            >
              {s.code}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">{states.length === 0 ? 'No state picked: shows up for every deal.' : `Shows up for deals in ${states.join(', ')}.`}</p>
      </div>

      {kind === 'email' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Subject</label>
          <input ref={subjectRef} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => setLastFocus('subject')} maxLength={200} />
        </div>
      )}

      {kind !== 'form' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">{kind === 'email' ? 'Message' : 'Letter text'}</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {MERGE_FIELDS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => insertField(f.key)}
                className="px-2 py-1 rounded-lg text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200"
                title={`Inserts {{${f.key}}}`}
              >
                + {f.label}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            className={`${inputCls} min-h-[260px] font-mono leading-relaxed`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setLastFocus('body')}
            maxLength={20000}
          />
          <p className="text-xs text-slate-500 mt-1">Items like {'{{client_first_name}}'} fill in from the deal when you use the template.</p>
        </div>
      )}

      {kind === 'form' && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="text-sm font-semibold text-slate-200 mb-1">Your form file</div>
          <p className="text-xs text-slate-400 mb-3">Upload the PDF or Word form you are licensed to use for the states above. Relay stores it for you and copies it into a deal when you pick it. Relay does not supply state legal forms.</p>
          {saved?.file_name && (
            <div className="flex items-center gap-3 mb-3 text-sm">
              <button type="button" className="text-blue-300 hover:text-blue-200 underline" onClick={openFile}>
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
            className="text-sm text-slate-300"
          />
          {!name.trim() && <p className="text-xs text-amber-300 mt-2">Give the template a name first.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !name.trim()}
          onClick={async () => {
            const row = await save();
            if (row) onSaved('Template saved.');
          }}
        >
          {busy ? 'Saving…' : 'Save template'}
        </button>
        <button type="button" className={btnGhost} onClick={onClose}>
          Cancel
        </button>
        {saved && (
          <>
            <button type="button" className={`${btnGhost} ml-auto`} onClick={archive} disabled={busy}>
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
