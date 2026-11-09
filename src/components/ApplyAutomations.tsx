'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import { TRIGGERS, type Category, type Step } from '@/lib/automation/library';

// "Apply Automations": shown while setting up a new transaction or listing. Lists the person's saved automations of the right
// type with a one-line summary; ticking some applies a separate copy of each when the file is created. Skippable.

interface Row { id: string; name: string; description: string; trigger_type: string; steps: Step[]; active: boolean }

export function summarizeSteps(steps: Step[]): string {
  const names: Record<string, string> = { send_email: 'email', create_task: 'checklist step', notify_me: 'notification', add_note: 'note' };
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${n} ${names[t] ?? t}${n === 1 ? '' : 's'}`).join(', ');
}

/** Applies the chosen automations to a file that now exists. Returns an error message to show, or null. */
export async function applyAutomations(scope: { transactionId?: string; listingId?: string }, templateIds: string[]): Promise<string | null> {
  if (templateIds.length === 0) return null;
  try {
    const res = await authFetch('/api/automation/instances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, templateIds }) });
    if (!res.ok) return (await res.json().catch(() => ({}))).error || 'The automations could not be applied.';
    return null;
  } catch {
    return 'The automations could not be applied.';
  }
}

export default function ApplyAutomations({ category, value, onChange }: { category: Category; value: string[]; onChange: (ids: string[]) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isFeatureOnClient('automation')) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/automation/templates');
        if (!res.ok) throw new Error('no');
        const data = await res.json();
        if (live) setRows((data.templates as (Row & { category: Category })[]).filter((x) => x.category === category && x.active));
      } catch {
        if (live) setFailed(true);
      }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [category]);

  if (!isFeatureOnClient('automation') || failed) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5" data-testid="apply-automations">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-white">Apply automations</h3>
        <Link href="/dashboard/automations" className="text-xs text-blue-300 hover:text-blue-200">Manage automations</Link>
      </div>
      {rows === null ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">You have no active {category} automations yet. You can skip this and apply them later from the file.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-400">Choose any that should run on this {category === 'transaction' ? 'transaction' : 'listing'}, or skip.</p>
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${value.includes(r.id) ? 'border-blue-400 bg-blue-500/10' : 'border-white/10'}`}>
                  <input type="checkbox" className="mt-1" checked={value.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{r.name}</span>
                    {r.description && <span className="block text-xs text-slate-400">{r.description}</span>}
                    <span className="block text-xs text-slate-500">{TRIGGERS.find((t) => t.id === r.trigger_type)?.label}: {summarizeSteps(r.steps)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
