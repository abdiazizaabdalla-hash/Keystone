'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Report { id: string; title: string; cadence: string; period_start: string; period_end: string; generated_at: string; notes: string | null }

const RANGES = [
  { v: 'last_week', label: 'Last full week (Mon–Sun)' },
  { v: 'last_month', label: 'Last full month' },
  { v: 'last_7', label: 'Last 7 days' },
  { v: 'last_30', label: 'Last 30 days' },
  { v: 'custom', label: 'Custom dates…' },
];

async function download(id: string, fallbackName: string) {
  const res = await authFetch(`/api/team/reports/${id}/download`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Could not download the report');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function TeamReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [cadence, setCadence] = useState('off');
  const [notes, setNotes] = useState('');
  const [range, setRange] = useState('last_week');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([authFetch('/api/team/reports/settings'), authFetch('/api/team/reports')]);
    const sj = await s.json().catch(() => ({}));
    const rj = await r.json().catch(() => ({}));
    if (s.ok) { setCadence(sj.cadence || 'off'); setNotes(sj.notes || ''); }
    if (r.ok) setReports(rj.reports || []);
    setSetupNeeded(!!sj.setupNeeded || !!rj.setupNeeded);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const saveSettings = async () => {
    setBusy('settings'); setMessage('');
    try {
      const res = await authFetch('/api/team/reports/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cadence, notes }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save');
      setMessage(cadence === 'off' ? 'Saved. Reports will not be created automatically.' : `Saved. A ${cadence} report will be created automatically.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(''); }
  };

  const generate = async () => {
    setBusy('generate'); setMessage('');
    try {
      const res = await authFetch('/api/team/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range, start, end, notes }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not build the report');
      await download(json.report.id, `team-report-${json.report.period_start}-to-${json.report.period_end}.xlsx`);
      setMessage('Report saved below and downloaded.');
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not build the report'); } finally { setBusy(''); }
  };

  const saveReportNotes = async (id: string) => {
    setBusy(id); setMessage('');
    try {
      const res = await authFetch(`/api/team/reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: editNotes }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save notes');
      setEditing(null);
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save notes'); } finally { setBusy(''); }
  };

  const input = 'bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none';
  return (
    <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 space-y-5">
      <div>
        <h2 className="font-display font-semibold text-slate-100 mb-1">Team reports</h2>
        <p className="text-sm text-slate-400">
          An Excel workbook with a tab each for a summary, transactions, listings, activity (new deals, closings, steps completed, deadlines met, listings) and your notes. Everything is grouped by agent.
          It is a status and activity report only &mdash; no prices, client names, documents, messages or contacts. Only the team owner can see or download these.
        </p>
        {setupNeeded && <p className="text-sm text-amber-300 mt-2">Reports need a one-time database update (add-team-reports.sql) before they can be saved.</p>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Notes to include in the Notes tab</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={5000} placeholder="Anything you want in every report: reminders, policies, follow-ups for the team…" className={`${input} w-full`} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Create automatically</label>
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={input}>
            <option value="off">Off</option>
            <option value="weekly">Every week (Monday, for the week before)</option>
            <option value="monthly">Every month (1st, for the month before)</option>
          </select>
        </div>
        <button type="button" onClick={saveSettings} disabled={busy === 'settings'} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">{busy === 'settings' ? 'Saving…' : 'Save schedule & notes'}</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Create one now</label>
          <select value={range} onChange={(e) => setRange(e.target.value)} className={input}>
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
        </div>
        {range === 'custom' && (
          <>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} aria-label="Start date" />
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} aria-label="End date" />
          </>
        )}
        <button type="button" onClick={generate} disabled={busy === 'generate'} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">{busy === 'generate' ? 'Building…' : 'Build & download (Excel)'}</button>
      </div>
      {message && <p className="text-sm text-slate-300">{message}</p>}

      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Saved reports</h3>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-500">None yet. Scheduled and manual reports show up here with a download link.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {reports.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm text-slate-100">{r.title}</p>
                    <p className="text-xs text-slate-500">{r.cadence === 'manual' ? 'Created by you' : `Automatic ${r.cadence}`} · {new Date(r.generated_at).toLocaleDateString()}{r.notes ? ' · has notes' : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setEditing(editing === r.id ? null : r.id); setEditNotes(r.notes || ''); }} className="px-3 py-1.5 text-sm text-slate-200 border border-white/10 rounded-lg hover:bg-white/5">Notes</button>
                    <button type="button" disabled={busy === `dl-${r.id}`} onClick={async () => { setBusy(`dl-${r.id}`); try { await download(r.id, `team-report-${r.period_start}-to-${r.period_end}.xlsx`); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not download'); } finally { setBusy(''); } }} className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-400 text-white rounded-lg disabled:opacity-50">Download</button>
                  </div>
                </div>
                {editing === r.id && (
                  <div className="mt-2 space-y-2">
                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} maxLength={5000} className={`${input} w-full`} />
                    <button type="button" onClick={() => saveReportNotes(r.id)} disabled={busy === r.id} className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-400 text-white rounded-lg disabled:opacity-50">Save notes</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
