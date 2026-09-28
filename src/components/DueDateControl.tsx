'use client';

import { DueDateMode, DueDateSpec } from '@/lib/dueDates';

const MODE_OPTIONS: { value: DueDateMode; label: string }[] = [
  { value: 'none', label: 'No due date' },
  { value: 'after_acceptance', label: 'Days after acceptance' },
  { value: 'before_closing', label: 'Days before closing' },
  { value: 'after_closing', label: 'Days after closing' },
  { value: 'fixed', label: 'Fixed date' },
];

/**
 * The single due-date control reused everywhere a checklist step's due
 * date is set: the custom-template builder in Settings, and per-deal at
 * transaction creation. Nothing here is computed or assumed -- it's a
 * plain controlled input over a DueDateSpec (see lib/dueDates.ts) that the
 * caller owns and persists.
 */
export default function DueDateControl({
  value,
  onChange,
  disabled,
}: {
  value: DueDateSpec;
  onChange: (next: DueDateSpec) => void;
  disabled?: boolean;
}) {
  const inputClass =
    'bg-slate-600 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50';

  const handleModeChange = (mode: DueDateMode) => {
    if (mode === 'fixed') {
      onChange({ mode, fixedDate: value.fixedDate ?? '' });
    } else if (mode === 'none') {
      onChange({ mode });
    } else {
      onChange({ mode, days: value.days ?? 0 });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value.mode}
        disabled={disabled}
        onChange={(e) => handleModeChange(e.target.value as DueDateMode)}
        className={`${inputClass} min-w-[10.5rem]`}
      >
        {MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {(value.mode === 'after_acceptance' || value.mode === 'before_closing' || value.mode === 'after_closing') && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            disabled={disabled}
            value={value.days != null ? String(value.days) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw !== '' && !/^\d{0,3}$/.test(raw)) return;
              onChange({ mode: value.mode, days: raw === '' ? 0 : Number(raw) });
            }}
            placeholder="0"
            className={`${inputClass} w-14 text-center`}
          />
          <span className="text-slate-500 text-xs whitespace-nowrap">days</span>
        </div>
      )}

      {value.mode === 'fixed' && (
        <input
          type="date"
          disabled={disabled}
          value={value.fixedDate ?? ''}
          onChange={(e) => onChange({ mode: 'fixed', fixedDate: e.target.value })}
          className={inputClass}
        />
      )}
    </div>
  );
}
