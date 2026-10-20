import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { OFFER_DOC_KINDS, type OfferDocKind } from '@/lib/offerTerms';

// Files behind a listing offer (purchase contract, addenda, counteroffers). Same private bucket and
// allowlist as the rest of the app's documents; content type comes from the extension, never the browser.

export const OFFER_BUCKET = 'transaction-documents';
export const MAX_OFFER_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_OFFER_FILES = 8;

export const OFFER_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export function offerFileType(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() || '';
  return OFFER_FILE_TYPES[ext] ?? null;
}

export function cleanDocKind(v: unknown): OfferDocKind {
  return OFFER_DOC_KINDS.includes(v as OfferDocKind) ? (v as OfferDocKind) : 'other';
}

/**
 * Uploads each file and records it against the offer. `placements[i]` says which version document i belongs to.
 * If anything fails, files already stored in this call are removed again and the error is thrown, so the caller can
 * undo the offer and nothing is left half-saved.
 */
export async function storeOfferFiles(params: {
  listingId: string;
  offerId: string;
  files: File[];
  kinds: OfferDocKind[];
  versionIds: (string | null)[];
  receivedAt: string;
}) {
  const stored: string[] = [];
  try {
    for (let i = 0; i < params.files.length; i++) {
      const file = params.files[i];
      const contentType = offerFileType(file.name);
      if (!contentType) throw new Error(`${file.name}: that file type is not allowed`);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `listings/${params.listingId}/offers/${params.offerId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabaseServer.storage.from(OFFER_BUCKET).upload(path, await file.arrayBuffer(), { contentType, upsert: false });
      if (upErr) throw upErr;
      stored.push(path);
      const { error } = await supabaseServer.from('listing_offer_documents').insert({
        offer_id: params.offerId,
        listing_id: params.listingId,
        version_id: params.versionIds[i] ?? null,
        file_name: file.name.slice(0, 300),
        storage_path: path,
        content_type: contentType,
        file_size: file.size,
        doc_kind: params.kinds[i] ?? 'other',
        received_at: params.receivedAt,
      });
      if (error) throw error;
    }
  } catch (error) {
    if (stored.length) await supabaseServer.storage.from(OFFER_BUCKET).remove(stored);
    throw error;
  }
}

/** Storage paths of every document behind one offer (or every offer on a listing), for cleanup before deleting rows. */
export async function offerDocPaths(filter: { offerId?: string; listingId?: string }): Promise<string[]> {
  let q = supabaseServer.from('listing_offer_documents').select('storage_path');
  if (filter.offerId) q = q.eq('offer_id', filter.offerId);
  if (filter.listingId) q = q.eq('listing_id', filter.listingId);
  const { data } = await q;
  return (data || []).map((d) => d.storage_path as string).filter(Boolean);
}
