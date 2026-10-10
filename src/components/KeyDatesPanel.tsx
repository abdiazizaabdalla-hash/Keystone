'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';

interface KeyDate {
  id: string;
  kind: string;
  label: string;
  due_date: string;
  completed: boolean;
  source: string;
  notify_agent: boolean;
}

const PRESETS: { kind: string; label: string }[] = [
  { kind: 'earnest_money', label: 'Earnest money due' },
  { kind: 'inspection', label: 'Inspection deadline' },
  { kind: 'appraisal', label: 'Appraisal deadline' },
  { kind: 'financing', label: 'Financing contingency' },
  { kind: 'title_commitment', label: 'Title commitment due' },
  { kind: 'custom', label: 'Custom…' },
];

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysFromToday(iso: string): number {
  const a = new Date(`${iso}T00:00:00`).getTime();
  const b = new Date(`${todayIso()}T00:00:00`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function badge(d: KeyDate): { text: string; cls: string } {
  if (d.completed) return { text: 'Done', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700' };
  const n = daysFromToday(d.due_date);
  if (n < 0) return { text: `${-n} day${n === -1 ? '' : 's'} overdue`, cls: 'bg-red-900/40 text-red-300 border-red-700' };
  if (n === 0) return { text: 'Today', cls: 'bg-amber-900/40 text-amber-300 border-amber-700' };
  if (n === 1) return { text: 'Tomorrow', cls: 'bg-amber-900/40 text-amber-300 border-amber-700' };
  if (n <= 7) return { text: `In ${n} days`, cls: 'bg-blue-900/40 text-blue-300 border-blue-700' };
  return { text: `In ${n} days`, cls: 'bg-slate-700/60 text-slate-300 border-slate-600' };
}

// A calendar file (.ics) with every open critical date as an all-day event
// plus a reminder the day before. Built in the browser from what's on screen,
// so there is nothing extra to authorize or store.
function buildIcs(address: string, dates: KeyDate[]): string {
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Relay TC//Critical dates//EN', 'CALSCALE:GREGORIAN'];
  for (const d of dates) {
    const start = d.due_date.replace(/-/g, '');
    const next = new Date(`${d.due_date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const end = next.toISOString().split('T')[0].replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@relaytc.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${esc(`${d.label} — ${address}`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${d.label} is tomorrow`)}`,
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export default function KeyDatesPanel({
  transactionId,
  propertyAddress,
  closingDate,
  canEdit,
}: {
  transactionId: string;
  propertyAddress: string;
  closingDate: string | null;
  canEdit: boolean;
}) {
  const [dates, setDates] = useState<KeyDate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [presetKind, setPresetKind] = useState('inspection');
  const [customLabel, setCustomLabel] = useState('');
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/transactions/${transactionId}/key-dates`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load critical dates');
      setDates(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load critical dates');
      setDates((prev) => prev ?? []);
    }
  }, [transactionId]);

  useEffect(() => {
    // Deferred so the initial fetch's setState isn't a synchronous effect update.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const add = async () => {
    if (!newDate) return;
    const preset = PRESETS.find((p) => p.kind === presetKind) || PRESETS[PRESETS.length - 1];
    const label = presetKind === 'custom' ? customLabel.trim() : preset.label;
    if (!label) {
      setError('Give the date a name');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/transactions/${transactionId}/key-dates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: presetKind, label, dueDate: newDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add date');
      setAdding(false);
      setNewDate('');
      setCustomLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add date');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await authFetch(`/api/key-dates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update date');
      setDates((prev) => (prev || []).map((d) => (d.id === id ? { ...d, ...data } : d)).sort((a, b) => a.due_date.localeCompare(b.due_date)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update date');
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await authFetch(`/api/key-dates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete date');
      setDates((prev) => (prev || []).filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete date');
    }
  };

  const downloadIcs = () => {
    const open = (dates || []).filter((d) => !d.completed);
    const blob = new Blob([buildIcs(propertyAddress, open)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'critical-dates.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  const openCount = (dates || []).filter((d) => !d.completed).length;

  return (
    <div className="pt-6 mt-6 border-t border-slate-600">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Critical Dates</p>
        {openCount > 0 && (
          <button
            type="button"
            onClick={downloadIcs}
            className="text-xs text-blue-400 hover:text-blue-300 transition whitespace-nowrap shrink-0"
          >
            Add to calendar
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Contract deadlines. You&apos;ll get a reminder 7, 3 and 1 days before, and daily once overdue.
      </p>

      {error && <p className="text-xs text-red-300 mb-3">{error}</p>}

      {dates === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {closingDate && (
            <div className="flex flex-col gap-2 p-3 bg-slate-700/40 border border-slate-600 rounded-lg">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-100">Closing</p>
                <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${badge({ completed: false, due_date: closingDate } as KeyDate).cls}`}>
                  {badge({ completed: false, due_date: closingDate } as KeyDate).text}
                </span>
              </div>
              <p className="text-xs text-slate-400">{formatDisplayDate(closingDate)}</p>
            </div>
          )}
          {dates.length === 0 && !closingDate && (
            <p className="text-sm text-slate-400 col-span-full">No critical dates yet. Upload a contract when creating a deal, or add them by hand.</p>
          )}
          {dates.map((d) => {
            const b = badge(d);
            return (
              <div key={d.id} className="flex flex-col gap-2 p-3 bg-slate-700/40 border border-slate-600 rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={d.completed}
                        onChange={(e) => patch(d.id, { completed: e.target.checked })}
                        className="shrink-0 mt-1"
                        aria-label={`Mark ${d.label} done`}
                      />
                    )}
                    <p className={`text-sm font-medium break-words ${d.completed ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{d.label}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${b.cls}`}>{b.text}</span>
                </div>
                {editingId === d.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (editValue) await patch(d.id, { dueDate: editValue });
                        setEditingId(null);
                      }}
                      className="text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-200">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-400">
                      {formatDisplayDate(d.due_date)}
                      {d.source === 'contract' ? ' · from contract' : ''}
                    </p>
                    {canEdit && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(d.id);
                            setEditValue(d.due_date);
                          }}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(d.id)} className="text-xs text-slate-400 hover:text-red-300" aria-label={`Delete ${d.label}`}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="mt-4">
          {adding ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={presetKind}
                  onChange={(e) => setPresetKind(e.target.value)}
                  className="px-2 py-1.5 bg-slate-700 border border-slate-500 rounded text-sm text-slate-100"
                >
                  {PRESETS.map((p) => (
                    <option key={p.kind} value={p.kind}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {presetKind === 'custom' && (
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    maxLength={100}
                    placeholder="Name (e.g. HOA docs due)"
                    className="px-2 py-1.5 bg-slate-700 border border-slate-500 rounded text-sm text-slate-100"
                  />
                )}
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="px-2 py-1.5 bg-slate-700 border border-slate-500 rounded text-sm text-slate-100"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={add}
                  disabled={saving || !newDate}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                >
                  {saving ? 'Adding…' : 'Add date'}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="text-sm text-slate-400 hover:text-slate-200">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="text-sm text-blue-400 hover:text-blue-300 transition">
              + Add a date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
