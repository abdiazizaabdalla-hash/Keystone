import { supabaseServer } from '@/lib/supabase';

// Catches the same property being started twice (a listing or a transaction). Addresses are compared after
// tidying: case, punctuation, "Street" vs "St" and so on, and an address typed with and without the city/zip
// still counts as the same place. A different unit number does not. The check is a guard, not a lock: the
// coordinator can choose to add it anyway (for example a property that sold again).

const SUFFIX: Record<string, string> = {
  street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', boulevard: 'blvd', place: 'pl',
  circle: 'cir', terrace: 'ter', parkway: 'pkwy', highway: 'hwy', trail: 'trl', way: 'way',
  north: 'n', south: 's', east: 'e', west: 'w', apartment: 'unit', apt: 'unit', suite: 'unit', ste: 'unit',
};

export function normalizeAddress(raw: string | null | undefined): string {
  return (raw || '')
    .toLowerCase()
    .replace(/#/g, ' unit ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] || w)
    .join(' ')
    .replace(/\bunit( unit)+\b/g, 'unit')
    .trim();
}

/** Same place? Equal after tidying, or one is the other plus extra trailing detail (city, state, zip). */
export function sameProperty(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeAddress(a);
  const y = normalizeAddress(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // Needs a street number and a street to count ("123 main st"), and the longer one must continue at a word boundary.
  if (!/^\d+\s+\S+/.test(short)) return false;
  if (!long.startsWith(`${short} `)) return false;
  // If the extra part names a different unit, it is a different place.
  const extra = long.slice(short.length + 1);
  return !/^unit\b/.test(extra);
}

export interface DuplicateHit {
  id: string;
  label: string;
}

const OPEN_LISTING = ['preparing', 'active', 'under_offer'];

export async function findOpenListingDuplicate(tcUserIds: string[], address: string, excludeId?: string): Promise<DuplicateHit | null> {
  if (!tcUserIds.length || !normalizeAddress(address)) return null;
  const { data } = await supabaseServer.from('listings').select('id, property_address, status').in('tc_user_id', tcUserIds).in('status', OPEN_LISTING).limit(2000);
  const hit = (data || []).find((l) => l.id !== excludeId && sameProperty(l.property_address as string, address));
  return hit ? { id: hit.id as string, label: hit.property_address as string } : null;
}

export async function findOpenTransactionDuplicate(tcUserIds: string[], address: string | null | undefined, fileNumber: string | null | undefined): Promise<(DuplicateHit & { by: 'address' | 'file_number' }) | null> {
  if (!tcUserIds.length) return null;
  const { data } = await supabaseServer.from('transactions').select('id, property_address, file_number, status').in('tc_user_id', tcUserIds).neq('status', 'Closed').limit(5000);
  const fn = (fileNumber || '').trim().toLowerCase();
  for (const t of data || []) {
    if (address && sameProperty(t.property_address as string, address)) return { id: t.id as string, label: (t.property_address as string) || (t.file_number as string), by: 'address' };
    if (fn && String(t.file_number || '').trim().toLowerCase() === fn) return { id: t.id as string, label: `File ${t.file_number}`, by: 'file_number' };
  }
  return null;
}
