'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import type { BuilderValue } from '@/components/AutomationBuilder';

// "New automation": describe it in plain English and get a draft to review, or build it yourself. The draft is never saved or
// run from here; it opens in the same popup as any other automation, and you save it.

const EXAMPLES = [
  'Email the buyer a welcome message when a transaction is created, and remind me to verify earnest money.',
  'Notify me 5 days before closing if the appraisal is not marked done.',
  'Three days after a contract is uploaded, email the agent to confirm all dates.',
  'Remind me 14, 7 and 2 days before a listing expires.',
];

export default function AiDraftDialog({ onClose, onManual, onDraft }: { onClose: () => void; onManual: () => void; onDraft: (v: BuilderValue, unsupported: string[]) => void }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<'transaction' | 'listing'>('transaction');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [unsupported, setUnsupported] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setError(null);
    setQuestions([]);
    setUnsupported([]);
    try {
      const res = await authFetch('/api/automation/ai/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: text, category }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not draft it');
      if (body.draft) return onDraft(body.draft as BuilderValue, body.unsupported ?? []);
      setQuestions(body.questions ?? []);
      setUnsupported(body.unsupported ?? []);
      setError(body.problem ?? (body.questions?.length || body.unsupported?.length ? null : 'Could not draft that. Try rewording.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft it');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="New automation" className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" data-testid="ai-draft-dialog">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">New automation</h2>
            <p className="mt-1 text-sm text-slate-400">Describe what should happen. You will review and edit the draft before anything is saved.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
        </div>
        <div className="mt-4 flex gap-1">
          {(['transaction', 'listing'] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-lg px-3 py-1.5 text-sm ${category === c ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{c === 'transaction' ? 'Transaction' : 'Listing'}</button>
          ))}
        </div>
        <textarea aria-label="Describe the automation" rows={4} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} placeholder="When a transaction is created, email the buyer a welcome and remind me to verify earnest money…"
          className="mt-2 w-full rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setText(x)} className="rounded-full border border-white/10 px-3 py-1 text-left text-xs text-slate-300 hover:bg-white/5">{x.length > 52 ? `${x.slice(0, 50)}…` : x}</button>)}
        </div>
        {questions.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-100" data-testid="ai-questions">
            <p className="font-medium">A few things to add:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{questions.map((q) => <li key={q}>{q}</li>)}</ul>
          </div>
        )}
        {unsupported.length > 0 && <p className="mt-3 text-xs text-slate-400">Not possible yet: {unsupported.join('; ')}.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onManual} className="text-xs text-slate-400 hover:text-slate-200">Build it myself</button>
          <button type="button" disabled={busy || text.trim().length < 8} onClick={() => void go()} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50" data-testid="ai-draft-go">{busy ? 'Drafting…' : 'Draft with AI'}</button>
        </div>
      </div>
    </div>
  );
}
