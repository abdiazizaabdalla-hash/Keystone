// Small helpers for drag-and-drop on document lists. Client-safe (no server imports).

// Custom drag type so a document being moved is never confused with a file
// dragged in from the computer.
export const DOC_DRAG_TYPE = 'application/x-relay-document';

type DragLike = { dataTransfer: DataTransfer | null };

function hasType(e: DragLike, type: string): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.prototype.indexOf.call(types, type) !== -1;
}

/** True when the drag carries files from outside the browser (computer, email app). */
export function isFileDrag(e: DragLike): boolean {
  return hasType(e, 'Files');
}

/** True when the drag is one of our own documents being moved. */
export function isDocDrag(e: DragLike): boolean {
  return hasType(e, DOC_DRAG_TYPE);
}

/** Marks a document as the thing being dragged. */
export function startDocDrag(e: React.DragEvent, docId: string) {
  e.dataTransfer.setData(DOC_DRAG_TYPE, docId);
  e.dataTransfer.effectAllowed = 'move';
}

/** Reads the dragged document id on drop (empty string when it is not one of ours). */
export function readDocDrag(e: React.DragEvent): string {
  const id = e.dataTransfer.getData(DOC_DRAG_TYPE);
  return typeof id === 'string' ? id : '';
}
