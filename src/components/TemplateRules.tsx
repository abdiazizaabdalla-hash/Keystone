'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Rule {
  id: string;
  enabled: boolean;
  trigger_event: 'deal_closed' | 'closing_date' | 'acceptance_date';
  offset_days: number;
  repeat_yearly: boolean;
  repeat_years: number;
  recipient_roles: string[];
}

const ROLES = ['Buyer', 'Seller', 'Agent', 'Lender', 'Title', 'Attorney', 'Inspector', 'Other'];
const inputCls = 'bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-blue-500 focus:outline-none';

/** "7 days after the closing date, every year for 5 years, for the Buyer and Seller" */
export function describeRule(r: Pick<Rule, 'trigger_event' | 'offset_days' | 'repeat_yearly' | 'repeat_years' | 'recipient_roles'>): string {
  const n = Math.abs(r.offset_days);
  const days = `${n} day${n === 1 ? '' : 's'}`;
  let when: string;
  if (r.trigger_event === 'deal_closed') when = r.offset_days === 0 ? 'When the deal is marked Closed' : `${days} after the deal is marked Closed`;
  else {
    const what = r.trigger_event === 'closing_date' ? 'the closing date' : 'the acceptance date';
    when = r.offset_days === 0 ? `On ${what}` : `${days} ${r.offset_days < 0 ? 'before' : 'after'} ${what}`;
  }
  const repeat = r.repeat_yearly ? `, then every year for ${r.repeat_years} year${r.repeat_years === 1 ? '' : 's'}` : '';
  const who = r.recipient_roles.length ? `, for the ${r.recipient_roles.join(' and ')}` : '';
  return `${when}${repeat}${who}`;
}

// Automatic rules for one template. A rule only ever makes a draft that waits in Approvals.
export default function TemplateRules({ templateId }: { templateId: string }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [trigger, setTrigger] = useState<Rule['trigger_event']>('deal_closed');
  const [direction, setDirection] = useState<'after' | 'before'>('after');
  const [days, setDays] = useState(0);
  const [yearly, setYearly] = useState(false);
  const [years, setYears] = useState(5);
  const [roles, setRoles] = useState<string[]>(['Buyer', 'Seller']);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authFetch(`/api/templates/${templateId}/rules`);
      if (cancelled) return;
      if (!res.ok) return setError('Could not load the rules');
      setRules((await res.json()) as Rule[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const offset = trigger === 'deal_closed' ? Math.abs(days) : direction === 'before' ? -Math.abs(days) : Math.abs(days);
      const res = await authFetch(`/api/templates/${templateId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger_event: trigger, offset_days: offset, repeat_yearly: yearly, repeat_years: years, recipient_roles: roles }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Could not add the rule');
      setAdding(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the rule');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (r: Rule) => {
    await authFetch(`/api/template-rules/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !r.enabled }) });
    reload();
  };
  const remove = async (r: Rule) => {
    if (!window.confirm('Delete this rule? Drafts waiting for approval from it are removed too.')) return;
    await authFetch(`/api/template-rules/${r.id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Automatic drafts</div>
          <p className="text-xs text-slate-400">Relay writes a draft from this template when a rule comes due. Nothing is sent until you approve it under Approvals.</p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-sm px-3 py-1.5 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg whitespace-nowrap">
            Add a rule
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-300 mt-2">{error}</div>}

      {rules && rules.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-slate-800/50 rounded-lg px-3 py-2">
              <span className={`text-sm ${r.enabled ? 'text-slate-100' : 'text-slate-500'}`}>{describeRule(r)}</span>
              <span className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} />
                  {r.enabled ? 'On' : 'Off'}
                </label>
                <button type="button" onClick={() => remove(r)} className="text-xs text-red-300 hover:text-red-200">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rules && rules.length === 0 && !adding && <p className="text-xs text-slate-500 mt-3">No rules yet. Add one, for example “7 days after closing” for a check-in email.</p>}

      {adding && (
        <div className="mt-3 space-y-3 bg-slate-800/40 rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span>Make a draft</span>
            {trigger !== 'deal_closed' && (
              <>
                <input type="number" min={0} max={3650} value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-20`} />
                <span>days</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value as 'after' | 'before')} className={inputCls}>
                  <option value="after">after</option>
                  <option value="before">before</option>
                </select>
              </>
            )}
            {trigger === 'deal_closed' && (
              <>
                <input type="number" min={0} max={3650} value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-20`} />
                <span>days after</span>
              </>
            )}
            <select
              value={trigger}
              onChange={(e) => {
                setTrigger(e.target.value as Rule['trigger_event']);
                setDirection('after');
              }}
              className={inputCls}
            >
              <option value="deal_closed">the deal is marked Closed</option>
              <option value="closing_date">the closing date</option>
              <option value="acceptance_date">the acceptance date</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
            Repeat every year (for example a home anniversary note) for
            <input type="number" min={1} max={20} value={years} disabled={!yearly} onChange={(e) => setYears(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} className={`${inputCls} w-16 disabled:opacity-40`} />
            years
          </label>
          <div>
            <p className="text-xs text-slate-400 mb-1">Who it is for</p>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoles((cur) => (cur.includes(role) ? cur.filter((x) => x !== role) : [...cur, role]))}
                  className={`px-2.5 py-1 rounded-lg text-xs ${roles.includes(role) ? 'bg-blue-500 text-white' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'}`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {describeRule({ trigger_event: trigger, offset_days: trigger === 'deal_closed' ? days : direction === 'before' ? -days : days, repeat_yearly: yearly, repeat_years: years, recipient_roles: roles })}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={add} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {busy ? 'Adding…' : 'Add rule'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-white/15 text-slate-200 text-sm font-semibold rounded-xl">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
