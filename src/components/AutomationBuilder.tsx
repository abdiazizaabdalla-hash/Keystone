'use client';

import { useState } from 'react';
import { RECIPIENT_ROLES, STEP_TYPES, TRIGGERS, VARIABLES, describeWhen, triggerOf, type Category, type Step, type StepType } from '@/lib/automation/library';

// The manual workflow builder: a trigger, then steps with timing. The same shape the server validates; nothing outside the
// catalog can be picked here, and the server checks it again on save.

export interface BuilderValue {
  name: string;
  description: string;
  category: Category;
  triggerType: string;
  steps: Step[];
}

const input = 'w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500';
const label = 'block text-xs font-medium text-slate-300 mb-1';

export const blankStep = (n: number, type: StepType = 'notify_me'): Step => ({ id: `s${n}`, type, when: { days: 0, direction: 'after' }, ...(type === 'send_email' ? { to: ['buyer'], subject: '', message: '' } : {}) });
export const blankAutomation = (category: Category): BuilderValue => ({
  name: '', description: '', category, triggerType: TRIGGERS.find((t) => t.category === category)!.id, steps: [blankStep(1, category === 'transaction' ? 'send_email' : 'notify_me')],
});

export default function AutomationBuilder({ initial, editing, saving, error, onSave, onCancel }: { initial: BuilderValue; editing: boolean; saving: boolean; error: string | null; onSave: (v: BuilderValue) => void; onCancel: () => void }) {
  const [v, setV] = useState<BuilderValue>(initial);
  const trigger = triggerOf(v.triggerType);
  const triggers = TRIGGERS.filter((t) => t.category === v.category);
  const stepTypes = STEP_TYPES.filter((s) => s.categories.includes(v.category));

  const setStep = (i: number, patch: Partial<Step>) => setV((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setV((x) => {
      const steps = [...x.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return x;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...x, steps };
    });
  const changeCategory = (category: Category) => setV((x) => ({ ...blankAutomation(category), name: x.name, description: x.description }));
  const changeTrigger = (triggerType: string) =>
    setV((x) => ({ ...x, triggerType, steps: x.steps.map((s) => (triggerOf(triggerType)?.kind === 'date' ? s : { ...s, when: { ...s.when, direction: 'after' } })) }));
  const nextId = () => `s${Math.max(0, ...v.steps.map((s) => Number(s.id.replace(/\D/g, '')) || 0)) + 1}`;

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(v); }} className="space-y-5" data-testid="automation-builder">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label} htmlFor="auto-name">Name</label>
          <input id="auto-name" className={input} value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Buyer onboarding" />
        </div>
        <div>
          <label className={label} htmlFor="auto-category">Type</label>
          <select id="auto-category" className={input} value={v.category} disabled={editing} onChange={(e) => changeCategory(e.target.value as Category)}>
            <option value="transaction">Transaction automation</option>
            <option value="listing">Listing automation</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={label} htmlFor="auto-desc">Description (optional)</label>
          <input id="auto-desc" className={input} value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="What this is for" />
        </div>
      </div>

      {/* Trigger -> steps, drawn top to bottom */}
      <div className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">When this happens</p>
        <select aria-label="Trigger" className={`${input} mt-2`} value={v.triggerType} onChange={(e) => changeTrigger(e.target.value)}>
          {triggers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {trigger && <p className="mt-1 text-xs text-slate-400">{trigger.help}</p>}
      </div>

      {v.steps.map((s, i) => (
        <div key={s.id} className="space-y-3">
          <div className="text-center text-slate-500" aria-hidden>↓</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4" data-testid="builder-step">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Then, step {i + 1}</p>
              <div className="flex gap-1 text-xs">
                <button type="button" className="rounded px-2 py-1 text-slate-300 hover:bg-white/10 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
                <button type="button" className="rounded px-2 py-1 text-slate-300 hover:bg-white/10 disabled:opacity-30" disabled={i === v.steps.length - 1} onClick={() => move(i, 1)}>Move down</button>
                <button type="button" className="rounded px-2 py-1 text-red-300 hover:bg-white/10 disabled:opacity-30" disabled={v.steps.length === 1} onClick={() => setV({ ...v, steps: v.steps.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <div>
                <label className={label}>Action</label>
                <select className={input} value={s.type} onChange={(e) => { const t = e.target.value as StepType; setStep(i, { ...blankStep(1, t), id: s.id, when: s.when }); }}>
                  {stepTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Days</label>
                <input type="number" min={0} max={365} className={`${input} md:w-24`} value={s.when.days} onChange={(e) => setStep(i, { when: { ...s.when, days: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) } })} />
              </div>
              <div>
                <label className={label}>Timing</label>
                <select className={input} value={s.when.direction} onChange={(e) => setStep(i, { when: { ...s.when, direction: e.target.value === 'before' ? 'before' : 'after' } })}>
                  <option value="after">after</option>
                  {trigger?.kind === 'date' && <option value="before">before</option>}
                </select>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">{trigger ? describeWhen(s, trigger.label) : ''}</p>

            {s.type === 'send_email' && (
              <div className="mt-3 space-y-3">
                <fieldset>
                  <legend className={label}>Send to</legend>
                  <div className="flex flex-wrap gap-2">
                    {RECIPIENT_ROLES.map((r) => {
                      const on = (s.to ?? []).includes(r.id);
                      return (
                        <label key={r.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${on ? 'border-blue-400 bg-blue-500/20 text-white' : 'border-white/10 text-slate-300'}`}>
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => setStep(i, { to: on ? (s.to ?? []).filter((x) => x !== r.id) : [...(s.to ?? []), r.id] })} />
                          {r.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Only people already on the deal can receive it. If nobody matches, nothing is sent and the history says why.</p>
                </fieldset>
                <div><label className={label}>Subject</label><input className={input} value={s.subject ?? ''} maxLength={200} onChange={(e) => setStep(i, { subject: e.target.value })} /></div>
                <div><label className={label}>Message</label><textarea rows={5} className={input} value={s.message ?? ''} maxLength={5000} onChange={(e) => setStep(i, { message: e.target.value })} /></div>
              </div>
            )}
            {s.type === 'create_task' && (
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <div><label className={label}>Checklist step</label><input className={input} value={s.name ?? ''} maxLength={255} onChange={(e) => setStep(i, { name: e.target.value })} placeholder="Verify earnest money delivery" /></div>
                <div><label className={label}>Due in (days, optional)</label><input type="number" min={0} max={365} className={`${input} md:w-28`} value={s.dueInDays ?? ''} onChange={(e) => setStep(i, { dueInDays: e.target.value === '' ? null : Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) })} /></div>
              </div>
            )}
            {s.type === 'notify_me' && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div><label className={label}>Notification</label><input className={input} value={s.title ?? ''} maxLength={160} onChange={(e) => setStep(i, { title: e.target.value })} placeholder="Closing is 5 days away" /></div>
                <div><label className={label}>Details (optional)</label><input className={input} value={s.body ?? ''} maxLength={160} onChange={(e) => setStep(i, { body: e.target.value })} /></div>
              </div>
            )}
            {s.type === 'add_note' && (
              <div className="mt-3"><label className={label}>Note</label><textarea rows={2} className={input} value={s.text ?? ''} maxLength={2000} onChange={(e) => setStep(i, { text: e.target.value })} /></div>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={v.steps.length >= 12} onClick={() => setV({ ...v, steps: [...v.steps, blankStep(1, v.category === 'transaction' ? 'send_email' : 'notify_me')].map((s, i, all) => (i === all.length - 1 ? { ...s, id: nextId() } : s)) })} className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40">+ Add step</button>
        <p className="text-xs text-slate-500">In subjects and messages you can use: {VARIABLES.map((x) => `{{${x.id}}}`).join('  ')}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-50" data-testid="builder-save">{saving ? 'Saving…' : editing ? 'Save changes' : 'Save automation'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
      </div>
    </form>
  );
}
