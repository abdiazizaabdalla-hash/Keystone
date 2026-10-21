import { parseDate, parsePrice, normalizeAddress } from './csvImport';

// QuickBooks Online CSV helpers (no QuickBooks connection involved -- the TC moves files by hand).
// Everything here is pure so it can be used in the browser (reading the uploaded file) and on the server.

/** QuickBooks takes at most this many invoices per import file. */
export const QB_MAX_INVOICES_PER_FILE = 100;
/** What each invoice line says it is for (shown on the invoice). */
export const FEE_DESCRIPTION = 'Transaction coordination fee';
/** The QuickBooks product/service a line is filed under. It must already exist in their QuickBooks, and "Services" is the one QuickBooks creates by default. */
export const DEFAULT_ITEM_NAME = 'Services';

/** YYYY-MM-DD (or an ISO timestamp) -> MM/DD/YYYY, which is what QuickBooks (US) expects. */
export function usDate(value: string | null | undefined): string {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

export const money = (n: number | null | undefined) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

// Column names follow QuickBooks' own invoice-import sample file; the import screen lets the user re-map
// any column, so a rename on their side is never fatal.
export const QB_INVOICE_HEADERS = [
  'InvoiceNo',
  'Customer',
  'InvoiceDate',
  'DueDate',
  'Memo',
  'Item(Product/Service)',
  'ItemDescription',
  'ItemQuantity',
  'ItemRate',
  'ItemAmount',
];

export const QB_PAYMENT_HEADERS = [
  'Invoice number',
  'Customer',
  'Payment date',
  'Amount received',
  'Refunded',
  'Net received',
  'Invoice amount',
  'Property',
  'File number',
  'Paid through',
];

export const QB_CUSTOMER_HEADERS = ['Customer', 'Company', 'Email', 'Phone'];

// ---------------------------------------------------------------------------
// Import: reading a QuickBooks export (CSV or Excel) of invoices.
// ---------------------------------------------------------------------------

export type QbFieldKey = 'number' | 'customer' | 'date' | 'due' | 'amount' | 'balance' | 'memo' | 'description' | 'paid_date';

interface QbField {
  key: QbFieldKey;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const QB_FIELDS: QbField[] = [
  { key: 'number', label: 'Invoice number', required: true, aliases: ['invoiceno', 'invoice no', 'invoice number', 'invoice #', 'num', 'number', 'no', 'doc number', 'ref no'] },
  { key: 'customer', label: 'Customer', required: true, aliases: ['customer', 'customer name', 'name', 'client', 'bill to'] },
  { key: 'amount', label: 'Amount', required: true, aliases: ['itemamount', 'item amount', 'amount', 'total', 'total amount', 'invoice amount', 'original amount', 'open amount'] },
  { key: 'date', label: 'Invoice date', aliases: ['invoicedate', 'invoice date', 'date', 'transaction date', 'txn date', 'create date'] },
  { key: 'due', label: 'Due date', aliases: ['duedate', 'due date', 'due'] },
  { key: 'balance', label: 'Open balance', aliases: ['open balance', 'balance', 'balance due', 'amount due', 'open amount'] },
  { key: 'memo', label: 'Memo / message', aliases: ['memo', 'memo description', 'memo/description', 'message', 'message displayed on invoice', 'note', 'notes', 'private note'] },
  { key: 'description', label: 'Line description', aliases: ['itemdescription', 'item description', 'description', 'product service description', 'product/service description', 'line description', 'item(product/service)', 'product service', 'product/service'] },
  { key: 'paid_date', label: 'Payment date', aliases: ['payment date', 'paid date', 'date paid', 'last payment date'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

/** How many known invoice columns a row of cells looks like -- used to skip the title lines QuickBooks reports put on top. */
function headerScore(cells: string[]): number {
  const cleaned = cells.map((c) => norm(String(c ?? '')));
  let score = 0;
  for (const f of QB_FIELDS) {
    if (f.aliases.map(norm).some((a) => cleaned.includes(a))) score += f.required ? 2 : 1;
  }
  return score;
}

/** Finds the header row (QuickBooks reports start with a title, company name and blank lines) and returns it with the rows under it. */
export function splitHeader(rows: string[][]): { headers: string[]; body: string[][] } | null {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const s = headerScore(rows[i]);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  if (best < 0 || bestScore < 3) return null;
  return { headers: rows[best].map((c) => String(c ?? '')), body: rows.slice(best + 1) };
}

export function autoMapQb(headers: string[]): Record<QbFieldKey, number> {
  const cleaned = headers.map(norm);
  const used = new Set<number>();
  const result = {} as Record<QbFieldKey, number>;
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of QB_FIELDS) {
      if (result[f.key] !== undefined && result[f.key] >= 0) continue;
      let found = -1;
      for (const alias of f.aliases.map(norm)) {
        const idx = cleaned.findIndex((h, i) => !used.has(i) && (pass === 'exact' ? h === alias : alias.length >= 6 && h.includes(alias)));
        if (idx >= 0) {
          found = idx;
          break;
        }
      }
      result[f.key] = found;
      if (found >= 0) used.add(found);
    }
  }
  return result;
}

/** Excel stores dates as day counts (45000 = 2023-03-15). Turns one into YYYY-MM-DD, or '' if it isn't one. */
export function excelSerialToIso(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return d.toISOString().split('T')[0];
}

/** A date cell from either CSV text ("10/21/2026") or Excel (a serial number). '' when empty, null when unreadable. */
export function readQbDate(value: string): string | '' | null {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^\d{5}(\.\d+)?$/.test(v)) return excelSerialToIso(v) || null;
  return parseDate(v);
}

export interface QbRowInput {
  row: number; // 1-based position in the file, for error messages
  number: string;
  customer: string;
  amount: number;
  date: string; // YYYY-MM-DD or ''
  due: string;
  balance: number | null; // null when the file has no open-balance column
  text: string; // memo + description, searched for an address / file number
  paid_date: string;
}

export interface QbRowIssue {
  row: number;
  reason: string;
}

/** Turns the table into clean rows. Lines that can't be an invoice (totals, blanks, bad amounts) are listed, not guessed at. */
export function readQbRows(body: string[][], map: Record<QbFieldKey, number>): { rows: QbRowInput[]; issues: QbRowIssue[] } {
  const rows: QbRowInput[] = [];
  const issues: QbRowIssue[] = [];
  const cell = (r: string[], k: QbFieldKey) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
  const seen = new Set<string>();
  body.forEach((r, i) => {
    const row = i + 1;
    if (r.every((c) => String(c ?? '').trim() === '')) return;
    const number = cell(r, 'number');
    const customer = cell(r, 'customer');
    // "Total" lines at the bottom of QuickBooks reports, and lines for other kinds of transactions.
    if (!number && !customer) return;
    if (/^total\b/i.test(number) || /^total\b/i.test(customer)) return;
    if (!number) return void issues.push({ row, reason: 'No invoice number' });
    if (!customer) return void issues.push({ row, reason: 'No customer' });
    const amount = parsePrice(cell(r, 'amount').replace(/^\((.*)\)$/, '-$1'));
    if (amount === '' || amount === null || amount <= 0) return void issues.push({ row, reason: 'Amount is empty, zero or not a number' });
    const date = readQbDate(cell(r, 'date'));
    const due = readQbDate(cell(r, 'due'));
    const paidDate = readQbDate(cell(r, 'paid_date'));
    if (date === null || due === null || paidDate === null) return void issues.push({ row, reason: 'A date could not be read' });
    let balance: number | null = null;
    if (map.balance >= 0) {
      const b = parsePrice(cell(r, 'balance'));
      balance = b === '' || b === null ? null : b;
    }
    // Multi-line invoices repeat the invoice number: keep the first line, add its description to the search text.
    const key = number.toLowerCase();
    if (seen.has(key)) {
      const prev = rows.find((x) => x.number.toLowerCase() === key);
      if (prev) {
        prev.amount = Math.round((prev.amount + amount) * 100) / 100;
        prev.text = `${prev.text} ${cell(r, 'memo')} ${cell(r, 'description')}`.trim();
      }
      return;
    }
    seen.add(key);
    rows.push({
      row,
      number,
      customer,
      amount,
      date: date || '',
      due: due || '',
      balance,
      text: `${cell(r, 'memo')} ${cell(r, 'description')}`.trim(),
      paid_date: paidDate || '',
    });
  });
  return { rows, issues };
}

// ---------------------------------------------------------------------------
// Matching a QuickBooks invoice to a Relay agent and deal.
// ---------------------------------------------------------------------------

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Does free text (a memo) mention this deal? By file number, or by the street part of its address. */
export function textMentionsDeal(text: string, deal: { file_number: string | null; property_address: string | null }): boolean {
  const t = normalizeAddress(text);
  if (!t) return false;
  const file = (deal.file_number || '').trim();
  if (file.length >= 4 && t.includes(normalizeAddress(file))) return true;
  const street = normalizeAddress((deal.property_address || '').split(',')[0] || '');
  return street.length >= 6 && t.includes(street);
}

/** Invoice number to store in Relay: Relay's own numbers stay as they are, everything else gets a QB- prefix so it can't collide. */
export function relayInvoiceNumber(qbNumber: string): string {
  const n = qbNumber.trim().replace(/\s+/g, ' ').slice(0, 90);
  return /^(RELAY|QB)-/i.test(n) ? n : `QB-${n}`;
}
