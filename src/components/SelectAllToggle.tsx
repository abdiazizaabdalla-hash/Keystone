'use client';

// "Select all" for one group of checkboxes. When every item in the group is already chosen it reads "Clear", so one button covers both.
// Items chosen elsewhere (outside this group) are left alone.
export default function SelectAllToggle({ items, selected, onChange, label }: { items: readonly string[]; selected: readonly string[]; onChange: (next: string[]) => void; label?: string }) {
  if (items.length === 0) return null;
  const all = items.every((t) => selected.includes(t));
  return (
    <button
      type="button"
      aria-label={`${all ? 'Clear' : 'Select all'}${label ? `: ${label}` : ''}`}
      onClick={() => onChange(all ? selected.filter((t) => !items.includes(t)) : [...selected, ...items.filter((t) => !selected.includes(t))])}
      className="ml-2 text-xs normal-case tracking-normal font-medium text-blue-400 hover:text-blue-300"
    >
      {all ? 'Clear' : 'Select all'}
    </button>
  );
}
