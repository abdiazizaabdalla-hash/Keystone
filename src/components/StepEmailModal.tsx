'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import {
  contactMatchesKind,
  defaultTemplateFor,
  fillTemplate,
  hasUnresolvedPrompts,
  MERGE_FIELDS,
  stepKey,
  type MergeVars,
  type StepEmailTemplate,
} from '@/lib/stepEmailTemplates';

// "Email" button on a checklist step opens this: the step's template with the
// deal's details filled in, the right people pre-ticked, and one click to send it
// (or open it in the TC's own email app). The template itself can be edited and
// saved per step, with {{merge fields}} so it keeps working on every deal.

interface Recipient {
  email: string;
  label: string;
}

interface CustomTemplate {
  key: string;
  name: string;
  subject: string;
  body: string;
}

interface Props {
  transactionId: string;
  taskId: string;
  stepName: string;
  stepDueDate?: string | null;
  fileNumber: string;
  propertyAddress: string;
  acceptanceDate?: string | null;
  closingDate?: string | null;
  agent: { name: string; email?: string | null } | null;
  contacts: { role: string | null; name: string | null; email: string | null }[];
  /** What the step is already marked "waiting on", if anything. */
  currentWaitingOn?: string | null;
  /** Called after a send marked the step as waiting on someone, so the page can show it. */
  onWaitingSet?: (taskId: string, waitingOn: string | null, waitingOnSince: string | null) => void;
  onClose: () => void;
}

const longDate = (iso?: string | null) => (iso ? formatDisplayDate(iso, { month: 'long', day: 'numeric', year: 'numeric' }) : '');

export default function StepEmailModal(props: Props) {
  const { transactionId, taskId, stepName, agent, contacts, onClose } = props;

  const [loading, setLoading] = useState(true);
  const [tcName, setTcName] = useState('');
  const [saved, setSaved] = useState<StepEmailTemplate | null>(null);
  const [mode, setMode] = useState<'send' | 'template'>('send');
  // 'step' = this step's own template; otherwise the key of one of my custom templates.
  const [choice, setChoice] = useState<string>('step');
  const [customs, setCustoms] = useState<CustomTemplate[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [logToDeal, setLogToDeal] = useState(true);
  const [markWaiting, setMarkWaiting] = useState(true);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rawSubject, setRawSubject] = useState('');
  const [rawBody, setRawBody] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');

  const [busy, setBusy] = useState<'send' | 'save' | 'reset' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  const defaults = useMemo(() => defaultTemplateFor(stepName), [stepName]);

  const recipients: Recipient[] = useMemo(() => {
    const list: Recipient[] = [];
    const seen = new Set<string>();
    if (agent?.email) {
      list.push({ email: agent.email, label: `${agent.name || 'Agent'} (agent)` });
      seen.add(agent.email.toLowerCase());
    }
    for (const c of contacts) {
      const e = (c.email || '').trim();
      if (!e || seen.has(e.toLowerCase())) continue;
      seen.add(e.toLowerCase());
      list.push({ email: e, label: `${c.name || e}${c.role ? ` (${c.role})` : ''}` });
    }
    return list;
  }, [agent, contacts]);

  const vars: MergeVars = useMemo(
    () => ({
      property_address: props.propertyAddress,
      file_number: props.fileNumber,
      agent_name: agent?.name || '',
      agent_first_name: (agent?.name || '').trim().split(/\s+/)[0] || '',
      acceptance_date: longDate(props.acceptanceDate),
      closing_date: longDate(props.closingDate),
      step_name: stepName,
      due_date: longDate(props.stepDueDate),
      tc_name: tcName,
    }),
    [props.propertyAddress, props.fileNumber, props.acceptanceDate, props.closingDate, props.stepDueDate, agent, stepName, tcName]
  );

  // Load my saved template for this step + my name, then fill the email in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let name = '';
      let mine: StepEmailTemplate | null = null;
      let loadedCustoms: CustomTemplate[] = [];
      try {
        const [tplRes, meRes] = await Promise.all([authFetch('/api/step-email-templates'), authFetch('/api/auth/me')]);
        if (meRes.ok) name = (await meRes.json()).fullName || '';
        if (tplRes.ok) {
          const all = (await tplRes.json()).templates || {};
          const found = all[stepKey(stepName)];
          if (found) mine = { subject: found.subject, body: found.body, suggestedRecipients: defaults.suggestedRecipients };
          loadedCustoms = Object.entries(all as Record<string, { subject: string; body: string; name?: string }>)
            .filter(([k]) => k.startsWith('custom:'))
            .map(([k, v]) => ({ key: k, name: v.name || k.slice(7), subject: v.subject, body: v.body }))
            .sort((a, b) => a.name.localeCompare(b.name));
        }
      } catch {
        // Fall back to the built-in template.
      }
      if (cancelled) return;
      const tpl = mine ?? defaults;
      const filledVars = { ...vars, tc_name: name || vars.tc_name };
      setTcName(name);
      setSaved(mine);
      setCustoms(loadedCustoms);
      setRawSubject(tpl.subject);
      setRawBody(tpl.body);
      setSubject(fillTemplate(tpl.subject, filledVars));
      setBody(fillTemplate(tpl.body, filledVars));

      // Pre-tick the people this email is usually for.
      const pre = new Set<string>();
      for (const kind of tpl.suggestedRecipients) {
        if (kind === 'agent' && agent?.email) pre.add(agent.email);
        for (const c of contacts) if (c.email && contactMatchesKind(c.role, kind)) pre.add(c.email);
      }
      setSelected(pre);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per opened step; `vars` is intentionally read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepName]);

  const toggle = (email: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  const allTo = (): string[] => {
    const list = [...selected];
    const e = extra.trim();
    if (e) list.push(...e.split(/[\s,;]+/).filter(Boolean));
    return [...new Set(list.map((x) => x.toLowerCase()))];
  };

  const unresolved = hasUnresolvedPrompts(subject, body);
  const recipientsNow = allTo();

  const send = async () => {
    setError('');
    setBusy('send');
    try {
      const res = await authFetch(`/api/transactions/${transactionId}/send-step-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipientsNow, subject, body, taskId, logToDeal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');

      // Optionally mark the step "waiting on" the first person emailed. The email
      // already went out, so a failure here is ignored rather than shown as a send error.
      if (markWaiting && !props.currentWaitingOn) {
        const target = recipients.find((r) => selected.has(r.email) && !r.label.endsWith('(agent)')) || recipients.find((r) => selected.has(r.email));
        const who = (target ? target.label : recipientsNow[0]).slice(0, 100);
        try {
          const wRes = await authFetch(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waitingOn: who }),
          });
          if (wRes.ok) {
            const w = await wRes.json();
            props.onWaitingSet?.(taskId, w.waiting_on ?? who, w.waiting_on_since ?? null);
          }
        } catch {
          // best effort
        }
      }
      setSentTo(recipientsNow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setBusy(null);
    }
  };

  const openMailApp = () => {
    const href = `mailto:${recipientsNow.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setNotice('Copied.');
    } catch {
      setNotice('Could not copy automatically.');
    }
    setTimeout(() => setNotice(''), 2000);
  };

  const refill = (s: string, b: string) => {
    setSubject(fillTemplate(s, vars));
    setBody(fillTemplate(b, vars));
  };

  const currentCustom = customs.find((c) => c.key === choice) || null;

  const chooseTemplate = (value: string) => {
    setChoice(value);
    setError('');
    const c = customs.find((x) => x.key === value);
    const tpl = c ? { subject: c.subject, body: c.body } : saved ?? defaults;
    setRawSubject(tpl.subject);
    setRawBody(tpl.body);
    refill(tpl.subject, tpl.body);
  };

  // Copies the chosen custom template onto this step, so this step opens with it from now on.
  const useForThisStep = async () => {
    if (!currentCustom) return;
    setError('');
    setBusy('save');
    try {
      const res = await authFetch('/api/step-email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepName, subject: currentCustom.subject, body: currentCustom.body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSaved({ subject: currentCustom.subject, body: currentCustom.body, suggestedRecipients: defaults.suggestedRecipients });
      setNotice(`“${currentCustom.name}” will open by default for “${stepName}”.`);
      setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(null);
    }
  };

  const startNewTemplate = () => {
    setError('');
    setCreating(true);
    setNewName('');
    setMode('template');
  };

  const saveTemplate = async () => {
    setError('');
    setBusy('save');
    try {
      const customName = creating ? newName.trim() : currentCustom?.name;
      if (creating && !customName) throw new Error('Give the template a name');
      const res = await authFetch('/api/step-email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customName ? { name: customName, subject: rawSubject, body: rawBody } : { stepName, subject: rawSubject, body: rawBody }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save template');
      if (customName) {
        const entry: CustomTemplate = { key: data.key as string, name: customName, subject: rawSubject, body: rawBody };
        setCustoms((prev) => [...prev.filter((c) => c.key !== entry.key), entry].sort((a, b) => a.name.localeCompare(b.name)));
        setChoice(entry.key);
      } else {
        setSaved({ subject: rawSubject, body: rawBody, suggestedRecipients: defaults.suggestedRecipients });
      }
      setCreating(false);
      refill(rawSubject, rawBody);
      setMode('send');
      setNotice(customName ? `Saved “${customName}”.` : 'Template saved for this step.');
      setTimeout(() => setNotice(''), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setBusy(null);
    }
  };

  const resetTemplate = async () => {
    setError('');
    setBusy('reset');
    try {
      const url = currentCustom
        ? `/api/step-email-templates?key=${encodeURIComponent(currentCustom.key)}`
        : `/api/step-email-templates?stepName=${encodeURIComponent(stepName)}`;
      const res = await authFetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to reset template');
      const tpl = saved && currentCustom ? saved : defaults;
      if (currentCustom) {
        setCustoms((prev) => prev.filter((c) => c.key !== currentCustom.key));
        setChoice('step');
      } else {
        setSaved(null);
      }
      setRawSubject(tpl.subject);
      setRawBody(tpl.body);
      refill(tpl.subject, tpl.body);
      setMode('send');
      setNotice(currentCustom ? 'Template deleted.' : 'Back to the default template.');
      setTimeout(() => setNotice(''), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset template');
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Email for ${stepName}`}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-700">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email for this step</p>
            <h2 className="text-lg font-bold text-slate-100 break-words">{stepName}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 text-sm shrink-0">
            Close
          </button>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-400">Loading…</p>
        ) : sentTo ? (
          <div className="px-6 py-8">
            <p className="text-green-400 font-semibold mb-1">Email sent</p>
            <p className="text-sm text-slate-300 break-words">To {sentTo.join(', ')}. A copy is in your inbox, and replies come straight to you.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg"
            >
              Done
            </button>
          </div>
        ) : mode === 'template' ? (
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-400">
              {creating
                ? 'A new template you can use on any step of any deal. '
                : currentCustom
                  ? `Editing your “${currentCustom.name}” template. `
                  : `This is the template for every deal’s “${stepName}” step. `}
              Use merge fields in double curly braces and Relay fills them in per deal. Anything in [square brackets] is left for you to
              fill in each time.
            </p>
            {creating && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Template name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Weekly update to agent"
                  className={inputCls}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {MERGE_FIELDS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setRawBody((b) => `${b}{{${f.key}}}`)}
                  className="text-xs px-2 py-1 rounded-full border border-slate-600 text-slate-300 hover:border-blue-500 hover:text-blue-300"
                  title={`Add ${f.label} to the end of the message`}
                >
                  {`{{${f.key}}}`}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Subject</label>
              <input value={rawSubject} onChange={(e) => setRawSubject(e.target.value)} maxLength={200} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Message</label>
              <textarea value={rawBody} onChange={(e) => setRawBody(e.target.value)} rows={12} maxLength={6000} className={`${inputCls} font-mono text-xs`} />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveTemplate}
                disabled={busy !== null || !rawSubject.trim() || !rawBody.trim() || (creating && !newName.trim())}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {busy === 'save' ? 'Saving…' : creating ? 'Save new template' : 'Save template'}
              </button>
              {!creating && (saved || currentCustom) && (
                <button type="button" onClick={resetTemplate} disabled={busy !== null} className="text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50">
                  {busy === 'reset' ? 'Working…' : currentCustom ? 'Delete this template' : 'Reset to default'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMode('send');
                  setCreating(false);
                  setError('');
                  if (creating) chooseTemplate(choice);
                }}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Template</label>
              <div className="flex flex-wrap items-center gap-3">
                <select value={choice} onChange={(e) => chooseTemplate(e.target.value)} className={`${inputCls} sm:w-auto sm:min-w-[16rem]`}>
                  <option value="step">{stepName} (this step)</option>
                  {customs.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={startNewTemplate} className="text-sm text-blue-400 hover:text-blue-300">
                  + New template
                </button>
                {currentCustom && (
                  <button type="button" onClick={useForThisStep} disabled={busy !== null} className="text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50">
                    Use for this step from now on
                  </button>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">To</p>
              {recipients.length === 0 ? (
                <p className="text-xs text-slate-500 mb-2">No email addresses on this deal yet. Add contacts below the checklist, or type one here.</p>
              ) : (
                <div className="space-y-1.5 mb-2">
                  {recipients.map((r) => (
                    <label key={r.email} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                      <input type="checkbox" checked={selected.has(r.email)} onChange={() => toggle(r.email)} className="accent-blue-500" />
                      <span className="min-w-0 break-words">
                        {r.label} <span className="text-slate-500">{r.email}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <input
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="Another address (optional)"
                className={inputCls}
                type="text"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Message</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={6000} className={inputCls} />
            </div>
            {unresolved && (
              <p className="text-xs text-amber-300">Replace the [bracketed] parts with your details before sending.</p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {notice && <p className="text-sm text-green-400">{notice}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={send}
                disabled={busy !== null || unresolved || recipientsNow.length === 0 || !subject.trim() || !body.trim()}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
              >
                {busy === 'send' ? 'Sending…' : 'Send email'}
              </button>
              <button type="button" onClick={openMailApp} disabled={recipientsNow.length === 0} className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50">
                Open in my email app
              </button>
              <button type="button" onClick={copyAll} className="text-sm text-slate-400 hover:text-slate-200">
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('template');
                  setError('');
                }}
                className="text-sm text-slate-400 hover:text-slate-200 ml-auto"
              >
                {currentCustom ? 'Edit this template' : 'Edit this step’s template'}
              </button>
            </div>
            {!props.currentWaitingOn && (
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={markWaiting} onChange={(e) => setMarkWaiting(e.target.checked)} className="accent-blue-500" />
                Mark this step &ldquo;waiting on&rdquo; the person I email
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={logToDeal} onChange={(e) => setLogToDeal(e.target.checked)} className="accent-blue-500" />
              Save a copy on this deal&rsquo;s Communication log (blind copy, others won&rsquo;t see it)
            </label>
            <p className="text-xs text-slate-500">
              Sent from Relay with your name. You are copied, and replies go straight to you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
