'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// Collaborate → Templates. The brokerage owner chooses which of their templates (a form like the brokerage's IABS, a
// welcome letter, an email) the agents and team members get. Shared ones show up pinned at the top of each member's
// Templates screen and in the template pickers on their deals. Everyone else sees the shared list, read-only.

interface Tpl {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  states: string[];
  file_name: string | null;
  brokerage_shared?: boolean;
  from_brokerage?: boolean;
  shared_by?: string;
}

const KIND: Record<Tpl['kind'], string> = { form: 'Form', letter: 'Letter', email: 'Email' };
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';
const kindChip = 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border bg-blue-500/20 text-blue-300 border-blue-500/40 shrink-0';

export default function BrokerageTemplates({ isOwner }: { isOwner: boolean }) {
  const [rows, setRows] = useState<Tpl[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/templates');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load templates');
    setRows(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load templates'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const setShared = async (id: string, shared: boolean) => {
    setBusy(id);
    setError('');
    try {
      const res = await authFetch(`/api/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brokerageShared: shared }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not change that');
      setPick('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that');
    } finally {
      setBusy('');
    }
  };

  const open = async (t: Tpl) => {
    const res = await authFetch(`/api/templates/${t.id}/file`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.open(data.url, '_blank', 'noopener');
  };

  if (!rows) return <p className="text-sm text-slate-400">{error || 'Loading templates…'}</p>;

  const sharedByMe = rows.filter((t) => !t.from_brokerage && t.brokerage_shared);
  const mine = rows.filter((t) => !t.from_brokerage && !t.brokerage_shared);
  const fromBrokerage = rows.filter((t) => t.from_brokerage);

  const row = (t: Tpl, action?: React.ReactNode) => (
    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-slate-100 font-medium truncate">{t.name}</span>
          <span className={kindChip}>{KIND[t.kind]}</span>
        </div>
        <p className="text-xs text-slate-500 truncate">
          {t.states.length === 0 ? 'All states' : t.states.join(', ')}
          {t.file_name ? ` · ${t.file_name}` : ''}
          {t.shared_by ? ` · from ${t.shared_by}` : ''}
        </p>
      </div>
      {t.file_name && (
        <button type="button" onClick={() => open(t)} className="text-xs text-blue-400 hover:text-blue-300">
          Open file
        </button>
      )}
      {action}
    </li>
  );

  if (!isOwner) {
    return (
      <div className="space-y-5 max-w-4xl">
        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">From your brokerage</h2>
          <p className="text-sm text-slate-400 mb-2">Templates your brokerage shares with you. They are pinned at the top of your Templates screen and offered on every deal.</p>
          {fromBrokerage.length === 0 ? <p className="text-sm text-slate-500">Nothing shared yet.</p> : <ul className="divide-y divide-white/5">{fromBrokerage.map((t) => row(t))}</ul>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Shared with your brokerage</h2>
            <p className="text-sm text-slate-400 max-w-2xl">
              Your agents and team members get these automatically: pinned at the top of their Templates screen and offered on their deals. They can use them but not change them.
            </p>
          </div>
          <Link href="/dashboard/templates?upload=iabs&share=1" className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition shrink-0">
            Upload your brokerage’s IABS
          </Link>
        </div>
        {sharedByMe.length === 0 ? (
          <p className="text-sm text-slate-500 mt-3">Nothing shared yet. Upload your IABS, or share one of your templates below.</p>
        ) : (
          <ul className="divide-y divide-white/5 mt-2">
            {sharedByMe.map((t) =>
              row(
                t,
                <button type="button" disabled={busy === t.id} onClick={() => setShared(t.id, false)} className="text-xs text-slate-400 hover:text-red-300 disabled:opacity-50">
                  Stop sharing
                </button>
              )
            )}
          </ul>
        )}
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Share another template</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-slate-500">
            You have no other templates yet. <Link href="/dashboard/templates" className="text-blue-400 hover:text-blue-300">Make one in Templates</Link>.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 max-w-xl">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Template to share" className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100">
              <option value="">Choose a template…</option>
              {mine.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({KIND[t.kind]})
                </option>
              ))}
            </select>
            <button type="button" disabled={!pick || busy === pick} onClick={() => setShared(pick, true)} className="px-4 py-2 border border-slate-600 hover:border-blue-500 text-slate-200 hover:text-blue-300 text-sm font-semibold rounded-lg transition disabled:opacity-50">
              Share with my brokerage
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
