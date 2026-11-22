'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { AI_FAILURE_LABEL, AI_FEATURE_LABEL } from '@/lib/aiFailureLabels';

interface Failure {
  id: string; created_at: string; user_id: string; feature: string; reason: string; detail: string | null;
  file_name: string | null; file_bytes: number | null; resolved_at: string | null; email: string | null; name: string | null;
}
const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const size = (b: number | null) => (b == null ? '' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Admin: AI document reads that did not work for someone (an unreadable file, a document that was not a contract, a file that was too large,
// an upload or service error), so you can reach out or fix the cause. No document contents are shown or stored.
export default function AdminAiFailures() {
  const [rows, setRows] = useState<Failure[] | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/admin/ai-failures?status=${status}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load AI read problems');
      setRows(json.failures);
      setNeedsSetup(json.needsSetup === true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load AI read problems'); }
  }, [status]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const mark = async (ids: string[], resolved: boolean) => {
    const res = await authFetch('/api/admin/ai-failures', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, resolved }) });
    if (res.ok) void load();
  };

  if (error) return <p className="text-red-400">{error}</p>;
  if (!rows) return <p className="text-slate-400">Loading…</p>;
  if (needsSetup) {
    return <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg p-4">This needs one database update first. Run <code>add-ai-failures.sql</code> in the Supabase SQL Editor, then reload this tab.</p>;
  }

  const open = rows.filter((r) => !r.resolved_at);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-400">AI reads that did not work for someone. Newest first. Document contents are never stored.</p>
        <div className="flex items-center gap-2">
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1 text-xs rounded-full border transition ${status === s ? 'border-blue-400 text-blue-300 bg-blue-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}>
              {s === 'open' ? 'Open' : s === 'resolved' ? 'Handled' : 'All'}
            </button>
          ))}
          {status !== 'resolved' && open.length > 1 && (
            <button type="button" onClick={() => void mark(open.map((r) => r.id), true)} className="px-3 py-1 text-xs rounded-full border border-slate-600 text-slate-300 hover:border-blue-400">Mark all handled</button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm">Nothing to show. When an AI read fails for someone it will appear here.</p>
      ) : (
        <div className="overflow-x-auto border border-slate-700 rounded-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-800/60">
              <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Read</th><th className="px-3 py-2">What happened</th><th className="px-3 py-2">File</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-slate-700 align-top ${r.resolved_at ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-300">{stamp(r.created_at)}</td>
                  <td className="px-3 py-2"><div className="text-slate-100">{r.name || r.email || 'Unknown'}</div>{r.name && r.email && <div className="text-xs text-slate-500">{r.email}</div>}</td>
                  <td className="px-3 py-2 text-slate-300">{AI_FEATURE_LABEL[r.feature] ?? r.feature}</td>
                  <td className="px-3 py-2"><div className="text-slate-100">{AI_FAILURE_LABEL[r.reason] ?? r.reason}</div>{r.detail && <div className="text-xs text-slate-500 max-w-xs break-words">{r.detail}</div>}</td>
                  <td className="px-3 py-2 text-slate-300"><div className="break-all max-w-[14rem]">{r.file_name || '—'}</div><div className="text-xs text-slate-500">{size(r.file_bytes)}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button type="button" onClick={() => void mark([r.id], !r.resolved_at)} className="text-xs text-blue-400 hover:text-blue-300">{r.resolved_at ? 'Reopen' : 'Mark handled'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
