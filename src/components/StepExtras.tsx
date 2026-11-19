'use client';

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
    else if (t === 'task_done' || t === 'task_open') onChange({ type: t, text: '' });
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
        <option value="task_done">a checklist step is completed</option>
        <option value="task_open">a checklist step is still open</option>
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
      {(value?.type === 'task_done' || value?.type === 'task_open') && <input aria-label="Step name" className={`${field} w-48`} placeholder="e.g. Closing prep" maxLength={80} value={value.text} onChange={(e) => onChange({ type: value.type, text: e.target.value })} />}
      {value?.type === 'no_document' && <input aria-label="Document name or type" className={`${field} w-48`} placeholder="e.g. Appraisal" maxLength={60} value={value.text} onChange={(e) => onChange({ type: 'no_document', text: e.target.value })} />}
    </div>
  );
}
