// Shared (client + server) definitions for the placed signature spots on a
// document sent for signature. No server-only imports here -- the field
// placer UI, the signing page and the PDF stamper all use these.

export type SigningFieldType = 'signature' | 'initials' | 'date';

export interface SigningField {
  id: string;
  type: SigningFieldType;
  /** 0-based page index. */
  page: number;
  /** Left / top / width / height as fractions (0-1) of the page, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Which signer fills this spot: 0-based index in the signing order.
   * Always 0 for single-signer requests.
   */
  signer: number;
}

export const MAX_SIGNING_FIELDS = 40;
export const MAX_SIGNERS = 8;

export const FIELD_LABEL: Record<SigningFieldType, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date',
};

/** Default box size per field type, as fractions of a portrait US-letter page. */
export const FIELD_DEFAULT_SIZE: Record<SigningFieldType, { w: number; h: number }> = {
  signature: { w: 0.28, h: 0.05 },
  initials: { w: 0.1, h: 0.04 },
  date: { w: 0.16, h: 0.03 },
};

const TYPES: SigningFieldType[] = ['signature', 'initials', 'date'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Validates and normalizes untrusted field input. Returns the cleaned
 * fields, or an error message. When `pageCount` is given, every field's
 * page must exist in the document.
 */
export function parseSigningFields(
  input: unknown,
  pageCount?: number
): { fields: SigningField[]; error?: string } {
  if (input === undefined || input === null) return { fields: [] };
  if (!Array.isArray(input)) return { fields: [], error: 'Signature spots must be a list' };
  if (input.length > MAX_SIGNING_FIELDS) {
    return { fields: [], error: `You can place at most ${MAX_SIGNING_FIELDS} signature spots` };
  }

  const fields: SigningField[] = [];
  const seenIds = new Set<string>();

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { fields: [], error: 'Invalid signature spot' };
    const r = raw as Record<string, unknown>;

    if (typeof r.type !== 'string' || !TYPES.includes(r.type as SigningFieldType)) {
      return { fields: [], error: 'Invalid signature spot type' };
    }
    const page = Number(r.page);
    if (!Number.isInteger(page) || page < 0 || (pageCount !== undefined && page >= pageCount)) {
      return { fields: [], error: 'A signature spot is on a page that does not exist' };
    }
    const nums = [r.x, r.y, r.w, r.h].map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      return { fields: [], error: 'Invalid signature spot position' };
    }

    const w = clamp(nums[2], 0.02, 0.9);
    const h = clamp(nums[3], 0.01, 0.3);
    const x = clamp(nums[0], 0, 1 - w);
    const y = clamp(nums[1], 0, 1 - h);

    const signerRaw = r.signer === undefined || r.signer === null ? 0 : Number(r.signer);
    if (!Number.isInteger(signerRaw) || signerRaw < 0 || signerRaw >= MAX_SIGNERS) {
      return { fields: [], error: 'A signature spot is assigned to an invalid signer' };
    }

    let id = typeof r.id === 'string' && r.id.length > 0 ? r.id.slice(0, 40) : `f${fields.length + 1}`;
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);

    fields.push({ id, type: r.type as SigningFieldType, page, x, y, w, h, signer: signerRaw });
  }

  return { fields };
}
