// How a coordinator's invoice total is built. Newer invoices remember their parts (flat fee, percentage fee, an adjustment such as a
// promotion discount and its note); older ones did not, so their parts are worked out from the agent's current fees as before.

export interface BreakdownLine {
  label: string;
  amount: number;
}

export interface BreakdownInvoice {
  amount_owed: number;
  kind?: string | null;
  description?: string | null;
  flat_fee?: number | null;
  percent_fee?: number | null;
  adjustment?: number | null;
  adjustment_note?: string | null;
}

export interface BreakdownAgent {
  flat_fee?: number | null;
  commission_percent?: number | null;
}

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function invoiceBreakdown(inv: BreakdownInvoice, agent: BreakdownAgent | null, purchasePrice: number | null): { lines: BreakdownLine[]; total: number } {
  const isListing = inv.kind === 'listing';
  const baseLabel = inv.description?.trim() || (isListing ? 'Listing coordination fee' : 'Transaction coordination fee (flat)');
  const stored = inv.flat_fee !== null && inv.flat_fee !== undefined;
  if (stored) {
    const lines: BreakdownLine[] = [{ label: baseLabel, amount: round2(Number(inv.flat_fee)) }];
    if (Number(inv.percent_fee) > 0) lines.push({ label: 'Percentage fee', amount: round2(Number(inv.percent_fee)) });
    if (Number(inv.adjustment) !== 0 && inv.adjustment !== null && inv.adjustment !== undefined) {
      lines.push({ label: inv.adjustment_note?.trim() || (Number(inv.adjustment) < 0 ? 'Discount' : 'Adjustment'), amount: round2(Number(inv.adjustment)) });
    }
    return { lines, total: round2(Number(inv.amount_owed)) };
  }
  const percent = Number(agent?.commission_percent) || 0;
  const lines: BreakdownLine[] = [{ label: baseLabel, amount: round2(Number(agent?.flat_fee) || 0) }];
  if (percent > 0) lines.push({ label: `Percentage fee (${percent}%)`, amount: round2(((Number(purchasePrice) || 0) * percent) / 100) });
  return { lines, total: round2(Number(inv.amount_owed)) };
}

export interface InvoiceEdits {
  flatFee?: unknown;
  percentFee?: unknown;
  discount?: unknown;
  discountNote?: unknown;
  description?: unknown;
}

export interface Defaults {
  flatFee: number;
  percentFee: number;
}

export class InvoiceEditError extends Error {}

const MAX = 10_000_000;
function amount(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX) throw new InvoiceEditError(`${label} must be a number between 0 and ${MAX.toLocaleString()}`);
  return round2(n);
}

/** The fees the coordinator confirmed (or the defaults when nothing was changed), validated, with the resulting total. */
export function resolveInvoiceAmounts(defaults: Defaults, edits: InvoiceEdits | undefined) {
  const e = edits || {};
  const flatFee = amount(e.flatFee, 'The fee', defaults.flatFee);
  const percentFee = amount(e.percentFee, 'The percentage fee', defaults.percentFee);
  const discount = amount(e.discount, 'The discount', 0);
  const subtotal = round2(flatFee + percentFee);
  if (discount > subtotal) throw new InvoiceEditError('The discount cannot be more than the fees it comes off');
  const note = typeof e.discountNote === 'string' ? e.discountNote.trim().slice(0, 140) : '';
  const description = typeof e.description === 'string' ? e.description.trim().slice(0, 140) : '';
  const edited = flatFee !== defaults.flatFee || percentFee !== defaults.percentFee || discount > 0 || description !== '';
  return { flatFee, percentFee, discount, discountNote: note, description, total: round2(subtotal - discount), edited };
}
