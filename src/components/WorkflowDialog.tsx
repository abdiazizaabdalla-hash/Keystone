'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { RECIPIENT_ROLES, VARIABLES, describeWhen, triggerOf, type Category, type Step } from '@/lib/automation/library';
import type { BuilderValue } from '@/components/AutomationBuilder';
import { ConditionPicker } from '@/components/StepExtras';

// A small popup for one automation: a picture of the workflow (click a step to edit it), then Save. Used by both the Library
// (adding a ready-made one) and Your automations (changing one you already have).

const GLYPH: Record<string, string> = { send_email: '✉', create_task: '☑', notify_me: '🔔', add_note: '✎' };
const WORD: Record<string, string> = { send_email: 'Email', create_task: 'Task', notify_me: 'Notify me', add_note: 'Note' };
const field = 'w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-sm text-white';
const lab = 'mb-1 block text-xs font-medium text-slate-300';

export interface DialogSource {
  name: string;
  description: string;
  category: Category;
  triggerType: string;
  steps: Step[];
  notes?: string[];
}

export default function WorkflowDialog({ preset, saving, error, saveLabel, banner, footerLeft, onClose, onSave, onFullEditor }: { preset: DialogSource; saving: boolean; error: string | null; saveLabel: string; banner?: ReactNode; footerLeft?: ReactNode; onClose: () => void; onSave: (v: BuilderValue) => void; onFullEditor: (v: BuilderValue) => void }) {
  const [name, setName] = useState(preset.name);
  const [steps, setSteps] = useState<Step[]>(() => preset.steps.map((s) => ({ ...s, when: { ...s.when } })));
  const [sel, setSel] = useState<string>(preset.steps[0].id);
  const trigger = triggerOf(preset.triggerType);
  const step = steps.find((s) => s.id === sel) ?? steps[0];
  const patch = (p: Partial<Step>) => setSteps((all) => all.map((s) => (s.id === step.id ? { ...s, ...p } : s)));
  const value = (): BuilderValue => ({ name, description: preset.description, category: preset.category, triggerType: preset.triggerType, steps });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={preset.name} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" data-testid="preset-dialog">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <input aria-label="Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent text-xl font-semibold text-white outline-none focus:border-b focus:border-blue-400" />
            <p className="mt-1 text-sm text-slate-400">{preset.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
        </div>

        {/* The workflow, as a picture: trigger, then each step. Click a step to edit it. */}
        <div className="mt-5 overflow-x-auto pb-2" data-testid="workflow-picture">
          <ol className="flex min-w-max items-stretch gap-2">
            <li className="flex w-28 flex-col items-center justify-center rounded-xl border border-blue-400/40 bg-blue-500/10 p-3 text-center">
              <span className="text-lg" aria-hidden>⚡</span>
              <span className="text-xs font-semibold text-blue-100">{trigger?.label}</span>
            </li>
            {steps.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="text-slate-500" aria-hidden>→</span>
                <button type="button" onClick={() => setSel(s.id)} aria-pressed={sel === s.id}
                  className={`flex h-full w-28 flex-col items-center rounded-xl border p-3 text-center transition ${sel === s.id ? 'border-blue-400 bg-blue-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  <span className="text-lg" aria-hidden>{GLYPH[s.type]}</span>
                  <span className="text-xs font-semibold text-white">{i + 1}. {WORD[s.type]}</span>
                  {s.condition && <span className="text-[10px] text-violet-300">if…</span>}
                  <span className="mt-0.5 text-[11px] text-slate-400">{s.when.days === 0 && s.when.direction === 'after' ? 'Right away' : `${s.when.days}d ${s.when.direction}`}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        {/* Edit the selected step */}
        <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4" data-testid="step-editor">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={lab} htmlFor="pd-days">Days</label>
              <input id="pd-days" type="number" min={0} max={365} className={`${field} w-20`} value={step.when.days} onChange={(e) => patch({ when: { ...step.when, days: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) } })} />
            </div>
            <div>
              <label className={lab} htmlFor="pd-dir">When</label>
              <select id="pd-dir" className={field} value={step.when.direction} onChange={(e) => patch({ when: { ...step.when, direction: e.target.value === 'before' ? 'before' : 'after' } })}>
                <option value="after">after</option>
                {trigger?.kind === 'date' && <option value="before">before</option>}
              </select>
            </div>
            <p className="pb-2 text-xs text-slate-400">{trigger ? describeWhen(step, trigger.label) : ''}</p>
            <button type="button" disabled={steps.length === 1} onClick={() => { const rest = steps.filter((s) => s.id !== step.id); setSteps(rest); setSel(rest[0].id); }} className="ml-auto pb-2 text-xs text-red-300 hover:text-red-200 disabled:opacity-30">Remove step</button>
          </div>

          {preset.category === 'transaction' && <ConditionPicker key={step.id} value={step.condition} onChange={(c) => patch({ condition: c })} />}

          {step.type === 'send_email' && (
            <>
              <fieldset>
                <legend className={lab}>Send to</legend>
                <div className="flex flex-wrap gap-2">
                  {RECIPIENT_ROLES.map((r) => {
                    const on = (step.to ?? []).includes(r.id);
                    return (
                      <label key={r.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${on ? 'border-blue-400 bg-blue-500/20 text-white' : 'border-white/10 text-slate-300'}`}>
                        <input type="checkbox" className="sr-only" checked={on} onChange={() => patch({ to: on ? (step.to ?? []).filter((x) => x !== r.id) : [...(step.to ?? []), r.id] })} />
                        {r.label}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-500">Matched against the people on each deal when it runs. If a role has no one on the deal, you will see a warning there.</p>
              </fieldset>
              <div><label className={lab} htmlFor="pd-subject">Subject</label><input id="pd-subject" className={field} value={step.subject ?? ''} maxLength={200} onChange={(e) => patch({ subject: e.target.value })} /></div>
              <div><label className={lab} htmlFor="pd-message">Message</label><textarea id="pd-message" rows={7} className={field} value={step.message ?? ''} maxLength={5000} onChange={(e) => patch({ message: e.target.value })} /></div>
              <p className="text-xs text-slate-500">You can use {VARIABLES.map((v) => `{{${v.id}}}`).join(' ')}</p>
            </>
          )}
          {step.type === 'create_task' && (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div><label className={lab} htmlFor="pd-task">Checklist step</label><input id="pd-task" className={field} value={step.name ?? ''} maxLength={255} onChange={(e) => patch({ name: e.target.value })} /></div>
              <div><label className={lab} htmlFor="pd-due">Due in (days)</label><input id="pd-due" type="number" min={0} max={365} className={`${field} sm:w-24`} value={step.dueInDays ?? ''} onChange={(e) => patch({ dueInDays: e.target.value === '' ? null : Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) })} /></div>
            </div>
          )}
          {step.type === 'notify_me' && <div><label className={lab} htmlFor="pd-title">Notification</label><input id="pd-title" className={field} value={step.title ?? ''} maxLength={160} onChange={(e) => patch({ title: e.target.value })} /></div>}
          {step.type === 'add_note' && <div><label className={lab} htmlFor="pd-note">Note</label><textarea id="pd-note" rows={2} className={field} value={step.text ?? ''} maxLength={2000} onChange={(e) => patch({ text: e.target.value })} /></div>}
        </div>

        {banner}
        {preset.notes && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200">{preset.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {footerLeft}
            <button type="button" className="text-slate-400 hover:text-slate-200" onClick={() => onFullEditor(value())}>Open in full editor</button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
            <button type="button" disabled={saving} onClick={() => onSave(value())} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-50" data-testid="preset-save">{saving ? 'Saving…' : saveLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

