'use client';

import { useState } from 'react';
import { COMING_SOON, PRESETS, type Preset } from '@/lib/automation/presets';
import { triggerOf, type Category } from '@/lib/automation/library';
import type { BuilderValue } from '@/components/AutomationBuilder';
import WorkflowDialog from '@/components/WorkflowDialog';

// The Library tab: ready-made automations as square cards. Clicking one opens the workflow popup.

export default function PresetLibrary({ owned, saving, error, onSave, onFullEditor }: { owned: Set<string>; saving: boolean; error: string | null; onSave: (v: BuilderValue) => Promise<boolean>; onFullEditor: (v: BuilderValue) => void }) {
  const [category, setCategory] = useState<Category>('transaction');
  const [open, setOpen] = useState<Preset | null>(null);
  const list = PRESETS.filter((p) => p.category === category);
  const soon = COMING_SOON.filter((c) => c.category === category || c.category === 'both');
  const tab = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`;

  return (
    <section className="space-y-4" data-testid="preset-library">
      <p className="text-sm text-slate-400">Ready-made automations. Open one to see how it works and change it, then add it to your list. Nothing runs until you apply it to a deal.</p>
      <div className="flex gap-1">
        <button type="button" className={tab(category === 'transaction')} onClick={() => setCategory('transaction')}>Transactions</button>
        <button type="button" className={tab(category === 'listing')} onClick={() => setCategory('listing')}>Listings</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p)} data-testid="preset-card"
            className="flex min-h-[170px] flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-blue-400/50 hover:bg-white/10">
            <span>
              <span className="block text-base font-semibold text-white">{p.name}</span>
              <span className="mt-1 block text-xs text-slate-400">{p.summary}</span>
            </span>
            <span className="mt-3 flex items-center justify-between text-xs">
              <span className="text-slate-500">{triggerOf(p.triggerType)?.label} · {p.steps.length} steps</span>
              {owned.has(p.name) && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-200">Added</span>}
            </span>
          </button>
        ))}
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
