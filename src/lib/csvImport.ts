// CSV import for transactions (built for an AFrame export, but works with any
// spreadsheet that has a column per field). Pure functions only: parsing,
// guessing which column is which, and cleaning dates / prices.

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  required?: boolean;
  /** Header names (any case/punctuation) that probably mean this field. */
  aliases: string[];
  hint?: string;
}

export type ImportFieldKey =
  | 'property_address'
  | 'file_number'
  | 'agent_name'
  | 'agent_email'
  | 'brokerage'
  | 'purchase_price'
  | 'acceptance_date'
  | 'closing_date'
  | 'client_name'
  | 'client_email'
  | 'lender_name'
  | 'lender_email'
  | 'title_name'
  | 'title_email';

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'property_address', label: 'Property address', required: true, aliases: ['property address', 'address', 'property', 'street address', 'subject property', 'listing address', 'property street'] },
  { key: 'file_number', label: 'File number', aliases: ['file number', 'file', 'file no', 'file #', 'transaction number', 'transaction id', 'deal id', 'id'], hint: 'Made up for you if empty' },
  { key: 'agent_name', label: 'Agent name', required: true, aliases: ['agent name', 'agent', 'agent full name', 'represented by', 'client agent', 'realtor'] },
  { key: 'agent_email', label: 'Agent email', aliases: ['agent email', 'agent e-mail', 'email agent', 'agent email address'] },
  { key: 'brokerage', label: 'Brokerage', aliases: ['brokerage', 'agent brokerage', 'company', 'broker'] },
  { key: 'purchase_price', label: 'Purchase price', aliases: ['purchase price', 'price', 'sales price', 'sale price', 'contract price', 'list price'] },
  { key: 'acceptance_date', label: 'Acceptance date', aliases: ['acceptance date', 'contract date', 'effective date', 'accepted date', 'ratified date', 'under contract', 'date accepted'] },
  { key: 'closing_date', label: 'Closing date', aliases: ['closing date', 'close date', 'closing', 'coe', 'close of escrow', 'settlement date', 'estimated closing'] },
  { key: 'client_name', label: 'Client name', aliases: ['client name', 'client', 'buyer name', 'buyer', 'seller name', 'seller', 'customer'] },
  { key: 'client_email', label: 'Client email', aliases: ['client email', 'buyer email', 'seller email', 'customer email'] },
  { key: 'lender_name', label: 'Lender name', aliases: ['lender name', 'lender', 'loan officer', 'mortgage company'] },
  { key: 'lender_email', label: 'Lender email', aliases: ['lender email', 'loan officer email'] },
  { key: 'title_name', label: 'Title / escrow contact', aliases: ['title company', 'title contact', 'escrow officer', 'title officer', 'title name', 'escrow', 'title'] },
  { key: 'title_email', label: 'Title / escrow email', aliases: ['title email', 'escrow email', 'escrow officer email', 'title company email'] },
];

export const MAX_IMPORT_ROWS = 500;

/** Parses CSV text (commas, semicolons or tabs; quoted cells; embedded newlines; BOM) into rows of cells. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',') as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

/** Guesses which CSV column holds each field. Returns field key -> column index (-1 when nothing fits). */
export function autoMap(headers: string[]): Record<ImportFieldKey, number> {
  const cleaned = headers.map(norm);
  const used = new Set<number>();
  const result = {} as Record<ImportFieldKey, number>;

  // Exact alias matches first, then "header contains alias", so "Agent Email"
  // is never claimed by the Agent name field.
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of IMPORT_FIELDS) {
      if (result[field.key] !== undefined && result[field.key] >= 0) continue;
      let found = -1;
      for (const alias of field.aliases.map(norm)) {
        const idx = cleaned.findIndex((h, i) => !used.has(i) && (pass === 'exact' ? h === alias : alias.length >= 5 && h.includes(alias)));
        if (idx >= 0) {
          found = idx;
          break;
        }
      }
      result[field.key] = found;
      if (found >= 0) used.add(found);
    }
  }
  return result;
}

/** Reads many common date spellings; returns YYYY-MM-DD, '' when empty, or null when it can't be understood. */
export function parseDate(value: string): string | '' | null {
  const v = value.trim();
  if (!v) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return valid(y, +m[1], +m[2]); // US order: month first
  }
  const t = Date.parse(`${v} UTC`);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** "$425,000" -> 425000; '' when empty; null when it isn't a number. */
export function parsePrice(value: string): number | '' | null {
  const v = value.trim();
  if (!v) return '';
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function normalizeAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
