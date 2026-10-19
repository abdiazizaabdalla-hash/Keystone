import { EMAIL_RE } from './stepEmailTemplates';

// Shared rules for the Contacts address book (see add-contacts-crm.sql).

export const MAX_TAGS_PER_CONTACT = 15;
export const MAX_TAG_LENGTH = 30;

export interface ContactRow {
  id: string;
  tc_user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  tags: string[];
  newsletter: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

/** Trims, de-duplicates (case-insensitive), and bounds a list of tags. */
export function cleanTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_CONTACT) break;
  }
  return out;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().slice(0, max);
  return v || null;
}

export type CleanContactResult =
  | { ok: true; value: { name: string; email: string | null; phone: string | null; company: string | null; role: string | null; notes: string | null; tags: string[]; newsletter: boolean } }
  | { ok: false; error: string };

/** Validates the fields a contact form sends. */
export function cleanContactInput(body: Record<string, unknown>): CleanContactResult {
  const name = text(body.name, 120) ?? '';
  const email = text(body.email, 254)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'That email address does not look right' };
  if (!name && !email) return { ok: false, error: 'Add a name or an email address' };
  return {
    ok: true,
    value: {
      name,
      email,
      phone: text(body.phone, 40),
      company: text(body.company, 120),
      role: text(body.role, 60),
      notes: text(body.notes, 2000),
      tags: cleanTags(body.tags),
      newsletter: body.newsletter === true && Boolean(email), // a newsletter needs an email address
    },
  };
}

/** Neutralizes spreadsheet formulas ("=...", "+...", "-...", "@...") in a CSV cell, then quotes it. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
