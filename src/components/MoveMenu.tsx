'use client';

// A small "move" icon button. Clicking it opens the device's own picker with
// the places the item can go (a native select laid invisibly over the icon),
// so it works with a mouse, keyboard and touch screen, and never gets clipped
// by the box it sits in.
export default function MoveMenu({
  options,
  onMove,
  disabled = false,
  label,
}: {
  options: { value: string; label: string }[];
  onMove: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span
      className={`relative inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-400 transition hover:border-blue-500 hover:text-blue-300 focus-within:border-blue-500 ${
        disabled ? 'opacity-50' : ''
      }`}
      title="Move to another area (or drag it onto one)"
    >
      {disabled ? (
        <span className="text-xs">…</span>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
        </svg>
      )}
      <select
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onMove(e.target.value);
        }}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        <option value="" disabled>
          Move to…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
