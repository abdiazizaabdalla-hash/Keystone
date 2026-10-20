'use client';

import { startDocDrag } from '@/lib/docDrag';

// The four-arrow grip at the top-left of a document. Only this handle starts
// a drag, so clicking links and buttons on the row never turns into an
// accidental move. The whole row is shown as the thing being dragged.
export default function DragHandle({ docId, label }: { docId: string; label: string }) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        startDocDrag(e, docId);
        const row = (e.currentTarget as HTMLElement).closest('[data-doc-row]');
        if (row) e.dataTransfer.setDragImage(row, 16, 16);
      }}
      onClick={(e) => e.stopPropagation()}
      role="img"
      aria-label={label}
      title="Drag to move to another area"
      className="inline-flex h-6 w-6 flex-shrink-0 cursor-grab items-center justify-center self-start rounded-md border border-slate-600 text-slate-400 transition hover:border-blue-500 hover:text-blue-300 active:cursor-grabbing"
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
      </svg>
    </span>
  );
}
