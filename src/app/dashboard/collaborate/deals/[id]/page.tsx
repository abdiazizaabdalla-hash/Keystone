'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';

// A brokerage owner's page for one deal of an agent in their brokerage. Everything shows read-only by default;
// the stage, the two key dates and the checklist ticks can be changed (the agent is told when they are).

interface Detail {
  deal: { id: string; property_address: string | null; file_number: string | null; status: string | null; purchase_price: number | string | null; acceptance_date: string | null; closing_date: string | null; updated_at: string | null };
  agent: { name: string; email: string | null } | null;
  tasks: { id: string; name: string; completed: boolean | null; due_date: string | null; waiting_on: string | null }[];
  keyDates: { id: string; kind: string; label: string; due_date: string; completed: boolean | null }[];
  documents: { id: string; file_name: string; created_at: string | null }[];
  health: { openTasks: number; overdueTasks: number; nextDue: string | null; flags: string[] };
}

const fmt = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set');
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function OversightDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch(`/api/oversight/deals/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load this deal');
    setDetail(data);
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load this deal'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const patchDeal = async (key: string, body: Record<string, unknown>) => {
    setSaving(key);
    setError('');
    try {
      const res = await authFetch(`/api/transactions/[id]?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save that change');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that change');
    } finally {
      setSaving('');
    }
  };

  const toggleTask = async (taskId: string) => {
    setSaving(taskId);
    setError('');
    try {
      const res = await authFetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save that change');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that change');
    } finally {
      setSaving('');
    }
  };

  if (!detail) {
    return (
      <div className="p-4 md:p-8 max-w-4xl">
        <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">← Back to your agents</Link>
        <p className="text-slate-400 text-sm mt-4">{error || 'Loading…'}</p>
      </div>
    );
  }

  const { deal, agent, tasks, keyDates, documents, health } = detail;
  const done = tasks.filter((t) => t.completed).length;
  const today = new Date().toISOString().slice(0, 10);
  const input = 'px-2 py-1.5 rounded-lg bg-slate-900/60 border border-white/10 text-sm text-slate-100';

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-5">
      <Link href="/dashboard/collaborate#agents" className="text-sm text-blue-400 hover:text-blue-300">← Back to your agents</Link>
      <div>
        <h1 className="text-2xl font-display font-semibold text-slate-100">{deal.property_address || deal.file_number || 'Deal'}</h1>
        <p className="text-slate-400 text-sm">
          {agent?.name ?? 'Agent'}
          {agent?.email ? ` · ${agent.email}` : ''} · File {deal.file_number}
        </p>
      </div>
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
      {health.flags.length > 0 && (
        <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Needs attention:{' '}
          {health.flags.map((f) => ({ overdue: `${health.overdueTasks} overdue step${health.overdueTasks === 1 ? '' : 's'}`, closing_soon: 'closing within 14 days with steps still open', no_closing_date: 'no closing date set' } as Record<string, string>)[f] ?? f).join(', ')}.
        </p>
      )}

      <div className={`${card} grid sm:grid-cols-3 gap-4`}>
        <label className="text-xs text-slate-400">
          Stage
          <select value={deal.status ?? ''} disabled={saving === 'status'} onChange={(e) => patchDeal('status', { status: e.target.value })} className={`${input} block w-full mt-1`}>
            {TRANSACTION_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Accepted
          <input type="date" defaultValue={deal.acceptance_date ?? ''} disabled={saving === 'acceptanceDate'} onBlur={(e) => e.target.value !== (deal.acceptance_date ?? '') && patchDeal('acceptanceDate', { acceptanceDate: e.target.value || null })} className={`${input} block w-full mt-1`} />
        </label>
        <label className="text-xs text-slate-400">
          Closing
          <input type="date" defaultValue={deal.closing_date ?? ''} disabled={saving === 'closingDate'} onBlur={(e) => e.target.value !== (deal.closing_date ?? '') && patchDeal('closingDate', { closingDate: e.target.value || null })} className={`${input} block w-full mt-1`} />
        </label>
        <p className="sm:col-span-3 text-xs text-slate-500">You can change the stage and these two dates. Changing them updates the checklist due dates and tells the agent.</p>
      </div>

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Checklist</h2>
        <p className="text-xs text-slate-400 mb-3">
          {done} of {tasks.length} done{health.nextDue ? ` · next due ${fmt(health.nextDue)}` : ''}
        </p>
        <ul className="divide-y divide-white/5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <input type="checkbox" checked={Boolean(t.completed)} disabled={saving === t.id} onChange={() => toggleTask(t.id)} aria-label={`Mark ${t.name} ${t.completed ? 'not done' : 'done'}`} className="h-4 w-4" />
              <span className={`flex-1 text-sm ${t.completed ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{t.name}</span>
              {t.waiting_on && !t.completed && <span className="text-xs text-slate-400">waiting on {t.waiting_on}</span>}
              {t.due_date && <span className={`text-xs ${!t.completed && t.due_date.slice(0, 10) < today ? 'text-amber-300' : 'text-slate-400'}`}>{fmt(t.due_date)}</span>}
            </li>
          ))}
          {tasks.length === 0 && <li className="text-sm text-slate-400 py-2">No checklist on this deal.</li>}
        </ul>
      </div>

      {keyDates.length > 0 && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-3">Key dates</h2>
          <ul className="divide-y divide-white/5">
            {keyDates.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`flex-1 ${k.completed ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{k.label}</span>
                <span className="text-xs text-slate-400">{fmt(k.due_date)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={card}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Documents</h2>
        <p className="text-xs text-slate-400 mb-3">Names only. The files themselves stay in the agent’s workspace.</p>
        {documents.length === 0 ? <p className="text-sm text-slate-400">None yet.</p> : (
          <ul className="text-sm text-slate-200 space-y-1">
            {documents.map((d) => (
              <li key={d.id}>{d.file_name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
