'use client';

import { useState } from 'react';
import { COMING_SOON, PRESETS, type Preset } from '@/lib/automation/presets';
import { RECIPIENT_ROLES, STEP_TYPES, describeWhen, triggerOf, type Category, type Step } from '@/lib/automation/library';

// The ready-made library: browse, read exactly what each one does (including every email), then add it as is or customize
// it first. Nothing here runs by itself; a preset only becomes active once it is saved and applied to a deal or listing.

const recipients = (to: string[] = []) => to.map((t) => RECIPIENT_ROLES.find((r) => r.id === t)?.label ?? t).join(', ');
const actionName = (s: Step) => STEP_TYPES.find((t) => t.id === s.type)?.label ?? s.type;

function StepView({ step, trigger }: { step: Step; trigger: string }) {
  return (
    <li className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
      <p className="text-xs text-blue-200">{describeWhen(step, trigger)}</p>
      <p className="mt-0.5 text-sm font-medium text-white">{actionName(step)}{step.type === 'send_email' && <span className="font-normal text-slate-400"> to {recipients(step.to)}</span>}</p>
      {step.type === 'send_email' && (
        <div className="mt-2 rounded-lg bg-white/5 p-3 text-xs text-slate-300">
          <p className="text-slate-400">Subject: <span className="text-slate-200">{step.subject}</span></p>
          <p className="mt-2 whitespace-pre-wrap">{step.message}</p>
        </div>
      )}
      {step.type === 'create_task' && <p className="text-xs text-slate-300">{step.name}{typeof step.dueInDays === 'number' ? ` (due in ${step.dueInDays} day${step.dueInDays === 1 ? '' : 's'})` : ''}</p>}
      {step.type === 'notify_me' && <p className="text-xs text-slate-300">{step.title}{step.body ? ` — ${step.body}` : ''}</p>}
      {step.type === 'add_note' && <p className="text-xs text-slate-300">{step.text}</p>}
    </li>
  );
}

export default function PresetLibrary({ busy, owned, onAdd, onCustomize }: { busy: boolean; owned: Set<string>; onAdd: (p: Preset) => void; onCustomize: (p: Preset) => void }) {
  const [category, setCategory] = useState<Category>('transaction');
  const [tier, setTier] = useState<'all' | 'essential' | 'advanced'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const list = PRESETS.filter((p) => p.category === category && (tier === 'all' || p.tier === tier));
  const soon = COMING_SOON.filter((c) => c.category === category || c.category === 'both');
  const pill = (on: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-blue-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`;

  return (
    <section className="space-y-4" data-testid="preset-library">
      <div className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-5">
        <h2 className="text-lg font-semibold text-white">Start with a ready-made automation</h2>
        <p className="mt-1 text-sm text-slate-200">These cover the repetitive work most coordinators and agents already do by hand: onboarding clients, chasing deadlines, closing prep, and following up after closing. Open any one to read every step and every email before you use it.</p>
        <ul className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-3">
          <li><span className="font-semibold text-white">1. Pick</span> a template and read what it will do.</li>
          <li><span className="font-semibold text-white">2. Customize</span> the wording and timing, or add it as is. It is saved to your own list.</li>
          <li><span className="font-semibold text-white">3. Apply</span> it when you create a transaction or listing, or from the deal Automation tab.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-400">Reminders never mark anything received or complete. Emails only go to people already on the deal, and on a deal in Draft mode each email waits for your approval. Nothing runs until you apply it to a deal.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={pill(category === 'transaction')} onClick={() => { setCategory('transaction'); setOpen(null); }}>Transactions</button>
        <button type="button" className={pill(category === 'listing')} onClick={() => { setCategory('listing'); setOpen(null); }}>Listings</button>
        <span className="mx-2 h-4 w-px bg-white/10" />
        {(['all', 'essential', 'advanced'] as const).map((t) => <button key={t} type="button" className={pill(tier === t)} onClick={() => setTier(t)}>{t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {category === 'listing' && <p className="text-xs text-slate-400">Listing automations send notifications and notes for now. Emails and tasks on listings are not available yet.</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p) => {
          const trigger = triggerOf(p.triggerType)?.label ?? p.triggerType;
          const isOpen = open === p.id;
          return (
            <article key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4" data-testid="preset-card">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-white">{p.name}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.tier === 'essential' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-violet-500/20 text-violet-200'}`}>{p.tier === 'essential' ? 'Essential' : 'Advanced'}</span>
              </div>
              <p className="mt-1 text-sm text-slate-300">{p.summary}</p>
              <p className="mt-2 text-xs text-slate-400">When: <span className="text-slate-200">{trigger}</span> · {p.steps.length} actions</p>
              {isOpen && (
                <div className="mt-3 space-y-2">
                  <ol className="space-y-2">{p.steps.map((s) => <StepView key={s.id} step={s} trigger={trigger} />)}</ol>
                  {p.notes && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5" onClick={() => setOpen(isOpen ? null : p.id)}>{isOpen ? 'Hide workflow' : 'View workflow and emails'}</button>
                <button type="button" disabled={busy} className="rounded-lg bg-blue-500 px-3 py-1.5 font-semibold text-white hover:bg-blue-400 disabled:opacity-50" onClick={() => onCustomize(p)} data-testid="preset-customize">Customize</button>
                <button type="button" disabled={busy || owned.has(p.name)} className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5 disabled:opacity-50" onClick={() => onAdd(p)} data-testid="preset-add">{owned.has(p.name) ? 'In your list' : 'Add as is'}</button>
              </div>
            </article>
          );
        })}
      </div>

      {soon.length > 0 && (
        <details className="rounded-2xl border border-dashed border-white/15 p-4">
          <summary className="cursor-pointer text-sm text-slate-300">Coming soon ({soon.length})</summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            {soon.map((c) => <li key={c.name}><span className="text-slate-200">{c.name}</span>: {c.summary} <span className="text-slate-500">Needs: {c.needs}</span></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
