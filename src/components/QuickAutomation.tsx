'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import AutomationBuilder, { blankAutomation, type BuilderValue } from '@/components/AutomationBuilder';
import AiDraftDialog from '@/components/AiDraftDialog';
import type { Step } from '@/lib/automation/library';

// Create a new automation, or change one, without leaving the deal or listing. A new one can be described in plain English or built
// by hand, then it is applied right here. An edit changes this file's copy only: the library version and other files are untouched
// unless you tick the box. Steps that already ran are not run again.

export interface EditTarget { id: string; templateId: string | null; name: string; category: 'transaction' | 'listing'; triggerType: string; steps: Step[] }
type Scope = { transactionId?: string; listingId?: string };
const json = { 'Content-Type': 'application/json' };
const errorOf = async (res: Response, fallback: string) => (await res.json().catch(() => ({}))).error || fallback;

export default function QuickAutomation({ scope, edit, onClose, onDone }: { scope: Scope; edit?: EditTarget | null; onClose: () => void; onDone: (message: string) => void }) {
  const category = scope.transactionId ? 'transaction' : 'listing';
  const [stage, setStage] = useState<'ai' | 'builder'>(edit ? 'builder' : 'ai');
  const [initial, setInitial] = useState<BuilderValue>(() => (edit ? { name: edit.name, description: '', category: edit.category, triggerType: edit.triggerType, steps: edit.steps } : blankAutomation(category)));
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [alsoLibrary, setAlsoLibrary] = useState(!edit); // new: saved to the library too; edit: this file only
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stage !== 'builder') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onClose]);

  if (stage === 'ai') {
    return <AiDraftDialog fixedCategory={category} onClose={onClose} onManual={() => { setInitial(blankAutomation(category)); setStage('builder'); }} onDraft={(v, u) => { setInitial(v); setUnsupported(u); setStage('builder'); }} />;
  }

  const save = async (v: BuilderValue) => {
    setSaving(true);
    setError(null);
    try {
      if (edit) {
        const res = await authFetch(`/api/automation/instances/${edit.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ definition: v }) });
        if (!res.ok) throw new Error(await errorOf(res, 'Could not save the changes'));
        if (alsoLibrary && edit.templateId) {
          const t = await authFetch(`/api/automation/templates/${edit.templateId}`, { method: 'PUT', headers: json, body: JSON.stringify(v) });
          if (!t.ok) throw new Error(`Saved here, but the library version could not be updated: ${await errorOf(t, 'try again from Automations')}`);
        }
        onDone(alsoLibrary && edit.templateId ? `Saved "${v.name}" here and in your library. Other files keep their own copy until you update them.` : `Saved "${v.name}" on this file only.`);
        return;
      }
      if (alsoLibrary) {
        const t = await authFetch('/api/automation/templates', { method: 'POST', headers: json, body: JSON.stringify(v) });
        if (!t.ok) throw new Error(await errorOf(t, 'Could not save it'));
        const id = ((await t.json()) as { template: { id: string } }).template.id;
        const a = await authFetch('/api/automation/instances', { method: 'POST', headers: json, body: JSON.stringify({ ...scope, templateIds: [id] }) });
        if (!a.ok) throw new Error(`Saved to your library, but it could not be added here: ${await errorOf(a, 'try again')}`);
        onDone(`Created "${v.name}", saved it to your library and added it here.`);
      } else {
        const a = await authFetch('/api/automation/instances', { method: 'POST', headers: json, body: JSON.stringify({ ...scope, definition: v }) });
        if (!a.ok) throw new Error(await errorOf(a, 'Could not add it'));
        onDone(`Created "${v.name}" for this file only.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={edit ? 'Edit automation' : 'New automation'} className="my-6 w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" data-testid="quick-automation">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">{edit ? 'Edit automation' : 'New automation'}</h2>
            <p className="mt-1 text-sm text-slate-400">{edit ? 'Changes apply to this file. Steps that already ran are not run again.' : `It will be added to this ${category} as soon as you save.`}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
        </div>
        {unsupported.length > 0 && <p className="mb-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-100">Not possible yet, so left out: {unsupported.join('; ')}.</p>}
        {(!edit || edit.templateId) && (
          <label className="mb-4 flex items-start gap-2 text-sm text-slate-200">
            <input type="checkbox" className="mt-1" checked={alsoLibrary} onChange={(e) => setAlsoLibrary(e.target.checked)} data-testid="quick-library" />
            <span>{edit ? 'Also update the version in my library' : 'Also save it to my library'}<span className="block text-xs text-slate-500">{edit ? 'Other files keep their own copy until you choose to update them.' : 'So you can add it to other transactions and listings later.'}</span></span>
          </label>
        )}
        <AutomationBuilder initial={initial} editing={Boolean(edit)} lockTrigger={Boolean(edit)} lockCategory reservedIds={edit?.steps.map((s) => s.id) ?? []} saving={saving} error={error} onSave={(v) => void save(v)} onCancel={onClose} saveLabel={edit ? 'Save changes' : 'Create and add'} />
      </div>
    </div>
  );
}
