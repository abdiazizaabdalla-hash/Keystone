import { DOCUMENT_CATEGORIES } from './documentTaxonomy';

// Brokerage file review rules. Pure (no database), so they can be unit tested.

export const REQUIRED_DOC_MAX = 40;
export const REVIEW_NOTE_MAX = 500;
/** How far back a closed file stays in the review list. */
export const REVIEW_WINDOW_DAYS = 180;
/** Files still open but closing within this many days are listed too, so gaps are found before closing. */
export const PRE_CLOSING_DAYS = 30;

/** Every document type an owner can require ("General" is a catch-all, so it cannot be required). */
export const REQUIRABLE_TYPES: string[] = DOCUMENT_CATEGORIES.flatMap((c) => c.types).filter((t) => t !== 'General');

/** The valid, de-duplicated document types from a request, in the order of the taxonomy. Anything else is dropped. */
export function cleanRequiredTypes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter((v): v is string => typeof v === 'string'));
  return REQUIRABLE_TYPES.filter((t) => wanted.has(t)).slice(0, REQUIRED_DOC_MAX);
}

/** The required types that no document on the file covers. */
export function missingRequired(required: string[], docs: { document_type: string | null }[]): string[] {
  const have = new Set(docs.map((d) => d.document_type).filter(Boolean) as string[]);
  return required.filter((t) => !have.has(t));
}

export type ReviewStatus = 'reviewed' | 'flagged';

export interface ReviewDeal {
  id: string;
  status: string | null;
  closing_date: string | null;
  updated_at: string | null;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Which files belong in the review list: closed files from the last REVIEW_WINDOW_DAYS days (by closing date, or the day last
 * updated), and open files closing within PRE_CLOSING_DAYS days.
 */
export function inReviewWindow(deal: ReviewDeal, closedStage: string, today: string): boolean {
  if (deal.status === closedStage) {
    const closedOn = (deal.closing_date || deal.updated_at || '').slice(0, 10);
    return closedOn >= addDays(today, -REVIEW_WINDOW_DAYS) && closedOn <= today;
  }
  return Boolean(deal.closing_date) && String(deal.closing_date) >= today && String(deal.closing_date) <= addDays(today, PRE_CLOSING_DAYS);
}

/** Files that need the owner first: missing documents and not yet reviewed, then flagged, then the rest; newest closing first. */
export function reviewSortKey(row: { missing: string[]; review: { status: ReviewStatus } | null; closingDate: string | null }): [number, string] {
  const rank = row.review?.status === 'flagged' ? 1 : row.review ? 3 : row.missing.length > 0 ? 0 : 2;
  return [rank, row.closingDate ?? ''];
}

export function compareReviewRows(a: Parameters<typeof reviewSortKey>[0], b: Parameters<typeof reviewSortKey>[0]): number {
  const [ra, da] = reviewSortKey(a);
  const [rb, db] = reviewSortKey(b);
  return ra - rb || db.localeCompare(da);
}
