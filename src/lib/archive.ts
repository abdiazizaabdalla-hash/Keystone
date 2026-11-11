// Archiving a transaction: the deal did not close (or never should have been opened), so it leaves everyday work without
// being deleted. It is its own flag (archived_at), separate from the stage, because the stage is derived from the checklist
// and would be overwritten. Pure and shared by the server and the screens.

export const ARCHIVE_REASONS = [
  { id: 'fell_through', label: 'Deal fell through' },
  { id: 'financing', label: 'Financing fell through' },
  { id: 'inspection', label: 'Inspection or appraisal issues' },
  { id: 'terminated', label: 'Contract terminated' },
  { id: 'client_cancelled', label: 'Client cancelled' },
  { id: 'listing_ended', label: 'Listing withdrawn or expired' },
  { id: 'duplicate', label: 'Duplicate or created by mistake' },
  { id: 'other', label: 'Other (add a note)' },
] as const;

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number]['id'];

export function isArchiveReason(value: unknown): value is ArchiveReason {
  return typeof value === 'string' && ARCHIVE_REASONS.some((r) => r.id === value);
}

export function archiveLabel(reason: string | null | undefined): string {
  return ARCHIVE_REASONS.find((r) => r.id === reason)?.label ?? 'Archived';
}

/** A deal row from the API. Rows from a database without the archive columns simply have no flag. */
export function isArchived(deal: { archived_at?: string | null } | null | undefined): boolean {
  return Boolean(deal?.archived_at);
}

export const ARCHIVE_NOTE_MAX = 500;

/** Validates what a person sent when archiving. Returns the cleaned values or the message to show them. */
export function cleanArchiveInput(body: unknown): { ok: true; reason: ArchiveReason; note: string | null } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isArchiveReason(b.reason)) return { ok: false, error: 'Pick a reason for archiving this transaction' };
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, ARCHIVE_NOTE_MAX) : '';
  if (b.reason === 'other' && !note) return { ok: false, error: 'Add a short note saying why' };
  return { ok: true, reason: b.reason, note: note || null };
}
