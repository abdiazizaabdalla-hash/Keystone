import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { OFFER_BUCKET, OFFER_FILE_TYPES } from '@/lib/listingOfferFiles';
import { MAX_INCOMING_SIZE, extensionOf, safeFileName } from '@/lib/incomingUploads';

// Offers that arrive by email. Each listing has its own private address, listing-<long random token>@<inbound domain>.
// Anything sent there is only HELD for the coordinator to review: attachments go to private storage, the email
// gets a short plain-text preview, and nothing becomes an offer until a person adds it. The address is not a
// secret login (anyone who has it can email it), so the rules below limit what a stranger can do with it:
// allowed file types only, size and count caps, a cap on how many unreviewed emails a listing can hold,
// and no HTML is ever stored or shown.

export const INBOUND_ROOT = 'listing-inbound';
export const MAX_PENDING_PER_LISTING = 30;
export const MAX_INBOUND_FILES = 8;
export const MAX_PENDING_BYTES = 500 * 1024 * 1024;
export const PENDING_MAX_AGE_DAYS = 30;

/** The listing token in a recipient address, e.g. "listing-3fa9...@mail.relaytc.com". 24–64 hex characters. */
export function extractListingToken(address: string): string | null {
  const local = address.split('@')[0]?.trim().toLowerCase();
  const match = local?.match(/^listing-([a-f0-9]{24,64})$/);
  return match ? match[1] : null;
}

export interface InboundAttachment {
  name: string;
  path: string;
  size: number;
}

/** True for the stored paths this feature creates for a given listing (used before any signed link is made). */
export function isInboundPath(listingId: string, path: unknown): path is string {
  return typeof path === 'string' && path.startsWith(`${INBOUND_ROOT}/${listingId}/`) && !path.includes('..');
}

export function inboundFileAllowed(name: string, size: number): boolean {
  return Boolean(OFFER_FILE_TYPES[extensionOf(name)]) && size > 0 && size <= MAX_INCOMING_SIZE;
}

export function inboundStoragePath(listingId: string, name: string): string {
  return `${INBOUND_ROOT}/${listingId}/${crypto.randomUUID()}-${safeFileName(name)}`;
}

export function previewOf(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function senderOf(from: string): { name: string | null; email: string } {
  const m = from.match(/^(.*?)<([^>]+)>$/);
  const name = m ? m[1].trim().replace(/^"|"$/g, '').slice(0, 120) || null : null;
  return { name, email: (m ? m[2].trim() : from.trim()).slice(0, 254) };
}

/** Removes the stored files behind an inbound item (best effort). */
export async function removeInboundFiles(attachments: unknown): Promise<void> {
  const paths = (Array.isArray(attachments) ? attachments : []).map((a) => (a as InboundAttachment)?.path).filter((p): p is string => typeof p === 'string' && p.startsWith(`${INBOUND_ROOT}/`));
  if (paths.length === 0) return;
  try {
    await supabaseServer.storage.from(OFFER_BUCKET).remove(paths);
  } catch (error) {
    console.error('Failed to remove inbound offer files (ignored):', error);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Marks a held email as imported or dismissed and deletes its stored files. Scoped to the listing. */
export async function closeInbound(listingId: string, inboundId: string, status: 'imported' | 'dismissed'): Promise<boolean> {
  const { data: row } = await supabaseServer.from('listing_inbound_offers').select('id, attachments, status').eq('id', inboundId).eq('listing_id', listingId).maybeSingle();
  if (!row) return false;
  const attachments = row.attachments;
  await supabaseServer.from('listing_inbound_offers').update({ status, attachments: [] }).eq('id', inboundId).eq('listing_id', listingId);
  await removeInboundFiles(attachments);
  return true;
}

/** Cron: held offer emails nobody reviewed within PENDING_MAX_AGE_DAYS are dismissed and their files deleted. */
export async function purgeStaleInbound(): Promise<number> {
  const cutoff = new Date(Date.now() - PENDING_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseServer.from('listing_inbound_offers').select('id, listing_id, attachments').eq('status', 'pending').lt('received_at', cutoff).limit(200);
  if (error || !data) return 0;
  for (const row of data) await closeInbound(row.listing_id as string, row.id as string, 'dismissed');
  return data.length;
}
