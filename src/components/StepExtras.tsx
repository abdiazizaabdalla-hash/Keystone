'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { CONDITION_KEY_KINDS, RECIPIENT_ROLES, type Condition } from '@/lib/automation/library';

const field = 'rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white';
const roles = RECIPIENT_ROLES.filter((r) => r.id !== 'everyone');

/** "Only if..." for one step. Fixed choices only; the server checks it again. */
export function ConditionPicker({ value, onChange }: { value: Condition | null | undefined; onChange: (c: Condition | null) => void }) {
  const type = value?.type ?? '';
  const set = (t: string) => {
    if (!t) return onChange(null);
    if (t === 'key_date_open') onChange({ type: 'key_date_open', kind: 'appraisal' });
    else if (t === 'no_document') onChange({ type: 'no_document', text: '' });
    else onChange({ type: t as 'role_present' | 'role_missing', role: 'lender' });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="condition-picker">
      <label className="text-xs font-medium text-slate-300" htmlFor="cond-type">Only if</label>
      <select id="cond-type" className={field} value={type} onChange={(e) => set(e.target.value)}>
        <option value="">always (no condition)</option>
        <option value="key_date_open">a Critical date is not marked done</option>
        <option value="role_missing">nobody has this role on the deal</option>
        <option value="role_present">someone has this role on the deal</option>
        <option value="no_document">no document like this is uploaded</option>
      </select>
      {value?.type === 'key_date_open' && (
        <select aria-label="Which date" className={field} value={value.kind} onChange={(e) => onChange({ type: 'key_date_open', kind: e.target.value })}>
          {CONDITION_KEY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      )}
      {(value?.type === 'role_present' || value?.type === 'role_missing') && (
        <select aria-label="Which role" className={field} value={value.role} onChange={(e) => onChange({ type: value.type, role: e.target.value })}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      )}
      {value?.type === 'no_document' && <input aria-label="Document name or type" className={`${field} w-48`} placeholder="e.g. Appraisal" maxLength={60} value={value.text} onChange={(e) => onChange({ type: 'no_document', text: e.target.value })} />}
    </div>
  );
}

/** "Write with AI" for an email step: type what you want, get a draft into the fields. You still read and edit it. */
export function AiEmailAssist({ subject, message, context, onResult }: { subject: string; message: string; context: string; onResult: (r: { subject: string; message: string }) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/automation/ai/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: text, subject, message, context }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not write it');
      onResult({ subject: body.subject, message: body.message });
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write it');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3" data-testid="ai-email-assist">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Tell the assistant what to write" className={`${field} min-w-0 flex-1`} placeholder={message ? 'e.g. make it shorter and friendlier' : 'e.g. remind the buyer to send proof of funds'} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim().length >= 3 && !busy) { e.preventDefault(); void go(); } }} />
        <button type="button" disabled={busy || text.trim().length < 3} onClick={() => void go()} className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50">{busy ? 'Writing…' : message ? 'Rewrite with AI' : 'Write with AI'}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      <p className="mt-1 text-xs text-slate-400">It replaces the subject and message above. Read it before saving; it can only use placeholders like {'{{address}}'}.</p>
    </div>
  );
}
