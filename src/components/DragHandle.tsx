// A tiny four-arrow icon at the top-left of a document. It is only a visual
// cue: the whole row can be dragged, this just shows that it can be.
export default function DragHandle({ label }: { label: string }) {
  return (
    <svg
      className="h-3 w-3 flex-shrink-0 self-start mt-1 cursor-grab text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
    >
      <title>Drag to move to another area</title>
      <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </svg>
  );
}
