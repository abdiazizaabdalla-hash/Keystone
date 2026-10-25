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
  /** 'person' or 'organization' (see add-contacts-relationships.sql). */
  contact_type?: ContactType;
  /** The organization contact this person works for. */
  organization_id?: string | null;
  /** The agent profile this contact is the address-book record for. */
  agent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type ContactType = 'person' | 'organization';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'text', 'meeting', 'other'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Escapes % _ and \ so an email can be used safely inside an ilike filter. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export interface ContactActivityRow {
  id: string;
  contact_id: string;
  kind: ActivityKind;
  body: string;
  occurred_at: string;
  created_at: string;
}

export interface ContactReminderRow {
  id: string;
  contact_id: string;
  due_on: string;
  note: string | null;
  done_at: string | null;
  created_at: string;
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
  | { ok: true; value: { name: string; email: string | null; phone: string | null; company: string | null; role: string | null; notes: string | null; tags: string[]; newsletter: boolean; contact_type?: ContactType; organization_id?: string | null } }
  | { ok: false; error: string };

/** Validates the fields a contact form sends. */
export function cleanContactInput(body: Record<string, unknown>): CleanContactResult {
  const name = text(body.name, 120) ?? '';
  const email = text(body.email, 254)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'That email address does not look right' };
  if (!name && !email) return { ok: false, error: 'Add a name or an email address' };
  // Only present when the form sends them, so saving still works for older clients.
  const extra: { contact_type?: ContactType; organization_id?: string | null } = {};
  if (body.contactType !== undefined) {
    if (body.contactType !== 'person' && body.contactType !== 'organization') return { ok: false, error: 'Type must be person or organization' };
    extra.contact_type = body.contactType;
  }
  if (body.organizationId !== undefined) {
    const org = body.organizationId;
    if (org === null || org === '') extra.organization_id = null;
    else if (typeof org === 'string' && UUID_RE.test(org)) extra.organization_id = org;
    else return { ok: false, error: 'That organization is not valid' };
    // an organization does not work for another organization
    if (extra.contact_type === 'organization') extra.organization_id = null;
  }
  return {
    ok: true,
    value: {
      ...extra,
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

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}
