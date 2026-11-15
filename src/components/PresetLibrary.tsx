'use client';

import { useState } from 'react';
import { COMING_SOON, PRESETS, type Preset } from '@/lib/automation/presets';
import { triggerOf, type Category } from '@/lib/automation/library';
import type { BuilderValue } from '@/components/AutomationBuilder';
import WorkflowDialog from '@/components/WorkflowDialog';

// The Library tab: ready-made automations as square cards. The switch on a card adds it to (or removes it from) Your automations;
// clicking the card opens the workflow popup to read it and change it first.

export default function PresetLibrary({ owned, saving, error, onSave, onFullEditor, onToggle }: { owned: Set<string>; onToggle: (p: Preset, on: boolean) => void | Promise<void>; saving: boolean; error: string | null; onSave: (v: BuilderValue) => Promise<boolean>; onFullEditor: (v: BuilderValue) => void }) {
  const [category, setCategory] = useState<Category>('transaction');
  const [open, setOpen] = useState<Preset | null>(null);
  const list = PRESETS.filter((p) => p.category === category);
  const soon = COMING_SOON.filter((c) => c.category === category || c.category === 'both');
  const tab = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`;

  return (
    <section className="space-y-4" data-testid="preset-library">
      <p className="text-sm text-slate-400">Ready-made automations. Switch one on to add it to Your automations, or open it to see how it works and change it first. Nothing runs until you apply it to a deal.</p>
      <div className="flex gap-1">
        <button type="button" className={tab(category === 'transaction')} onClick={() => setCategory('transaction')}>Transactions</button>
        <button type="button" className={tab(category === 'listing')} onClick={() => setCategory('listing')}>Listings</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => {
          const on = owned.has(p.name);
          return (
            <div key={p.id} className="relative min-h-[170px] rounded-2xl border border-white/10 bg-white/5 transition hover:border-blue-400/50 hover:bg-white/10" data-testid="preset-card">
              <button type="button" onClick={() => setOpen(p)} className="flex h-full min-h-[170px] w-full flex-col justify-between p-4 pr-16 text-left">
                <span>
                  <span className="block text-base font-semibold text-white">{p.name}</span>
                  <span className="mt-1 block text-xs text-slate-400">{p.summary}</span>
                </span>
                <span className="mt-3 block text-xs text-slate-500">{triggerOf(p.triggerType)?.label} · {p.steps.length} steps</span>
              </button>
              <button type="button" role="switch" aria-checked={on} aria-label={`${p.name}: ${on ? 'in' : 'not in'} Your automations`} title={on ? 'In Your automations. Switch off to remove it.' : 'Switch on to add it to Your automations'}
                disabled={saving} onClick={() => void onToggle(p, !on)} data-testid="preset-toggle"
                className={`absolute right-3 top-3 h-6 w-11 rounded-full transition disabled:opacity-60 ${on ? 'bg-emerald-500' : 'bg-white/20'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          );
        })}
      </div>
      {soon.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-400">Coming soon ({soon.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {soon.map((c) => <li key={c.name}><span className="text-slate-300">{c.name}</span> · needs {c.needs.charAt(0).toLowerCase() + c.needs.slice(1)}</li>)}
          </ul>
        </details>
      )}
      {open && <WorkflowDialog key={open.id} preset={{ ...open, description: open.summary }} saveLabel="Add to my automations" saving={saving} error={error} onClose={() => setOpen(null)} onFullEditor={(v) => { setOpen(null); onFullEditor(v); }} onSave={async (v) => { if (await onSave(v)) setOpen(null); }} />}
    </section>
  );
}
