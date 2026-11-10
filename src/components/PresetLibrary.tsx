'use client';

import { useState } from 'react';
import { COMING_SOON, PRESETS, type Preset } from '@/lib/automation/presets';
import { RECIPIENT_ROLES, STEP_TYPES, describeWhen, triggerOf, type Category, type Step } from '@/lib/automation/library';

// Ready-made automations: preview exactly what one does (every email included), then add it or customize it first.
// Nothing runs until a saved automation is applied to a deal or listing.

const recipients = (to: string[] = []) => to.map((t) => RECIPIENT_ROLES.find((r) => r.id === t)?.label ?? t).join(', ');

function StepView({ step, trigger }: { step: Step; trigger: string }) {
  const kind = STEP_TYPES.find((t) => t.id === step.type)?.label ?? step.type;
  return (
    <li className="border-l-2 border-white/10 pl-3">
      <p className="text-xs text-slate-400">{describeWhen(step, trigger)}</p>
      <p className="text-sm text-white">{kind}{step.type === 'send_email' && <span className="text-slate-400"> to {recipients(step.to)}</span>}</p>
      {step.type === 'send_email' && (
        <div className="mt-1 rounded-lg bg-white/5 p-3 text-xs text-slate-300">
          <p className="font-medium text-slate-200">{step.subject}</p>
          <p className="mt-1 whitespace-pre-wrap">{step.message}</p>
        </div>
      )}
      {step.type === 'create_task' && <p className="text-xs text-slate-300">{step.name}</p>}
      {step.type === 'notify_me' && <p className="text-xs text-slate-300">{step.title}</p>}
      {step.type === 'add_note' && <p className="text-xs text-slate-300">{step.text}</p>}
    </li>
  );
}

export default function PresetLibrary({ busy, owned, onAdd, onCustomize }: { busy: boolean; owned: Set<string>; onAdd: (p: Preset) => void; onCustomize: (p: Preset) => void }) {
  const [category, setCategory] = useState<Category>('transaction');
  const [open, setOpen] = useState<string | null>(null);
  const list = PRESETS.filter((p) => p.category === category);
  const soon = COMING_SOON.filter((c) => c.category === category || c.category === 'both');
  const tab = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`;

  return (
    <section className="space-y-3" data-testid="preset-library">
      <div>
        <h2 className="text-lg font-semibold text-white">Ready-made automations</h2>
        <p className="text-sm text-slate-400">Add one to your list, or customize it first. Nothing runs until you apply it to a deal.</p>
      </div>
      <div className="flex gap-1">
        <button type="button" className={tab(category === 'transaction')} onClick={() => { setCategory('transaction'); setOpen(null); }}>Transactions</button>
        <button type="button" className={tab(category === 'listing')} onClick={() => { setCategory('listing'); setOpen(null); }}>Listings</button>
      </div>

      <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
        {list.map((p) => {
          const trigger = triggerOf(p.triggerType)?.label ?? p.triggerType;
          const isOpen = open === p.id;
          return (
            <li key={p.id} className="p-4" data-testid="preset-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
                  <span className="block text-sm font-semibold text-white">{p.name}</span>
                  <span className="block text-xs text-slate-400">{p.summary}</span>
                </button>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button type="button" disabled={busy} className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/5" onClick={() => onCustomize(p)} data-testid="preset-customize">Customize</button>
                  <button type="button" disabled={busy || owned.has(p.name)} className="rounded-lg bg-blue-500 px-3 py-1.5 font-semibold text-white hover:bg-blue-400 disabled:bg-white/10 disabled:text-slate-400" onClick={() => onAdd(p)} data-testid="preset-add">{owned.has(p.name) ? 'Added' : 'Add'}</button>
                </div>
              </div>
              {isOpen && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-slate-400">Starts when: <span className="text-slate-200">{trigger}</span></p>
                  <ol className="space-y-3">{p.steps.map((s) => <StepView key={s.id} step={s} trigger={trigger} />)}</ol>
                  {p.notes && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {category === 'listing' && <p className="text-xs text-slate-500">Listing automations send notifications and notes for now.</p>}

      {soon.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-400">Coming soon ({soon.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {soon.map((c) => <li key={c.name}><span className="text-slate-300">{c.name}</span> · needs {c.needs.charAt(0).toLowerCase() + c.needs.slice(1)}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
