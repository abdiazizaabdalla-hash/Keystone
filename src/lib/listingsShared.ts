// Browser-safe pieces of the Listings feature (no database or server imports), so pages can use them.
// The server-only helpers live in ./listings.

export const LISTING_STATUSES = ['preparing', 'active', 'under_offer', 'converted', 'expired', 'withdrawn'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  preparing: 'Preparing',
  active: 'Active',
  under_offer: 'Under offer',
  converted: 'Under contract',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

export const OFFER_STATUSES = ['received', 'countered', 'accepted', 'rejected', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface TemplateStep {
  name: string;
  offsetDays: number;
}

/** Starter listing checklist, used until a TC saves their own. Days are relative to the planned list date. */
export const DEFAULT_LISTING_STEPS: TemplateStep[] = [
  { name: 'Listing agreement signed and filed', offsetDays: -21 },
  { name: 'Seller disclosures and required forms collected', offsetDays: -14 },
  { name: 'Photographer scheduled', offsetDays: -14 },
  { name: 'Staging or declutter walkthrough', offsetDays: -12 },
  { name: 'Photos, video and floor plan delivered', offsetDays: -7 },
  { name: 'Repairs, cleaning and landscaping done', offsetDays: -7 },
  { name: 'Listing description and MLS data prepared', offsetDays: -5 },
  { name: 'Yard sign and lockbox ordered', offsetDays: -3 },
  { name: 'Review price and launch plan with seller', offsetDays: -2 },
  { name: 'Listing entered in MLS', offsetDays: 0 },
  { name: 'Confirm listing is live and syndicated', offsetDays: 0 },
  { name: 'Open house or broker tour scheduled', offsetDays: 3 },
  { name: 'First weekly update to seller', offsetDays: 7 },
  { name: 'Review showing feedback and price', offsetDays: 14 },
];

export const MAX_TEMPLATE_STEPS = 60;

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueFromOffset(plannedListDate: string | null | undefined, offsetDays: number | null | undefined): string | null {
  if (!plannedListDate || offsetDays === null || offsetDays === undefined) return null;
  return addDaysIso(plannedListDate, offsetDays);
}

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

export function cleanMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? n : null;
}


export const LISTING_DOC_TYPES = ['General', 'Listing Agreement', 'Seller Disclosure', 'Other Contract Documents'];
