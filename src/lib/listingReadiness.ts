import { LISTING_STATUS_LABEL, type ListingStatus } from '@/lib/listingsShared';

// What a listing still needs before it can go live, worked out from what is already on the listing.
// Nothing here is stored except which required documents the TC marked "not needed".

/** Documents every listing package is expected to have. A TC can mark one "not needed" per listing. */
export const REQUIRED_LISTING_DOCS = ['Listing Agreement', 'Seller Disclosure'] as const;

export interface ReadinessItem {
  key: string;
  label: string;
  done: boolean;
  /** Short explanation shown under the label. */
  detail: string;
  /** Set for required documents: the document type this row stands for (can be marked not needed). */
  docType?: string;
  waived?: boolean;
}

interface ReadinessInput {
  listing: {
    agent_id: string | null;
    seller_name: string | null;
    seller_email: string | null;
    list_price: number | null;
    planned_list_date: string | null;
    docs_not_needed?: string[] | null;
  };
  docs: { document_type: string }[];
  tasks: { completed: boolean; due_date: string | null }[];
}

export function computeReadiness({ listing, docs, tasks }: ReadinessInput): { items: ReadinessItem[]; doneCount: number; total: number; missingDocs: string[] } {
  const waived = new Set(listing.docs_not_needed || []);
  const items: ReadinessItem[] = [];

  for (const type of REQUIRED_LISTING_DOCS) {
    const have = docs.filter((d) => d.document_type === type).length;
    const isWaived = waived.has(type);
    items.push({
      key: `doc:${type}`,
      label: `${type} on file`,
      done: have > 0 || isWaived,
      detail: isWaived ? 'Marked not needed for this listing' : have > 0 ? `${have} file${have === 1 ? '' : 's'} uploaded` : 'Not uploaded yet',
      docType: type,
      waived: isWaived,
    });
  }

  items.push({ key: 'price', label: 'List price set', done: Boolean(listing.list_price), detail: listing.list_price ? 'Set' : 'Add it under Details' });
  items.push({ key: 'date', label: 'Planned list date set', done: Boolean(listing.planned_list_date), detail: listing.planned_list_date ? 'Set' : 'Add it under Details; steps are dated from it' });
  const hasSeller = Boolean(listing.seller_name && listing.seller_email);
  items.push({ key: 'seller', label: 'Seller name and email', done: hasSeller, detail: hasSeller ? 'Set' : 'Needed to send the seller updates' });
  items.push({ key: 'agent', label: 'Listing agent assigned', done: Boolean(listing.agent_id), detail: listing.agent_id ? 'Assigned' : 'Pick the agent under Details' });

  // Steps that should be finished by go-live: everything dated on or before the list date (all steps when there is no date).
  const dueBefore = tasks.filter((t) => !listing.planned_list_date || !t.due_date || t.due_date <= listing.planned_list_date);
  const open = dueBefore.filter((t) => !t.completed).length;
  items.push({
    key: 'steps',
    label: 'Pre-listing steps finished',
    done: dueBefore.length > 0 && open === 0,
    detail: dueBefore.length === 0 ? 'No steps on the checklist' : open === 0 ? 'All done' : `${open} still open`,
  });

  const missingDocs = items.filter((i) => i.docType && !i.done).map((i) => i.docType as string);
  return { items, doneCount: items.filter((i) => i.done).length, total: items.length, missingDocs };
}

const money = (n: number | null | undefined) => (n ? `$${Number(n).toLocaleString('en-US')}` : 'not set');
const dayText = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'not set';

/** A plain-text property sheet to paste into the MLS entry, an email or a notes app. Only what is logged here. */
export function buildListingSummary(i: {
  listing: {
    property_address: string;
    status: ListingStatus;
    list_price: number | null;
    planned_list_date: string | null;
    expiration_date: string | null;
    mls_number: string | null;
    mls_url: string | null;
    seller_name: string | null;
    seller_email: string | null;
    seller_phone: string | null;
    notes: string | null;
  };
  agentName: string | null;
  docs: { document_type: string; file_name: string }[];
  dates: { label: string; due_date: string }[];
  missingDocs: string[];
}): string {
  const { listing } = i;
  const lines: string[] = [
    `LISTING SUMMARY — ${listing.property_address}`,
    '',
    `Status: ${LISTING_STATUS_LABEL[listing.status] || listing.status}`,
    `List price: ${money(listing.list_price)}`,
    `Planned list date: ${dayText(listing.planned_list_date)}`,
    `Agreement expires: ${dayText(listing.expiration_date)}`,
    `MLS number: ${listing.mls_number || 'not set'}${listing.mls_url ? ` (${listing.mls_url})` : ''}`,
    `Listing agent: ${i.agentName || 'not assigned'}`,
    '',
    'Seller',
    `  ${listing.seller_name || 'not set'}`,
    `  ${[listing.seller_email, listing.seller_phone].filter(Boolean).join(' · ') || 'no contact details'}`,
  ];
  const upcoming = [...i.dates].sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (upcoming.length) {
    lines.push('', 'Key dates');
    for (const d of upcoming) lines.push(`  ${dayText(d.due_date)} — ${d.label}`);
  }
  lines.push('', 'Documents on file');
  if (i.docs.length === 0) lines.push('  none yet');
  for (const d of i.docs) lines.push(`  ${d.document_type}: ${d.file_name}`);
  if (i.missingDocs.length) lines.push('', `Still missing: ${i.missingDocs.join(', ')}`);
  if (listing.notes && listing.notes.trim()) lines.push('', 'Notes', `  ${listing.notes.trim().replace(/\n+/g, '\n  ')}`);
  return lines.join('\n');
}
