// Money math for an agent's invoices. Kept free of database imports so it can be tested on its own.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Subtotal, tax and total for an invoice, rounded to cents. Negative or non-numeric input counts as zero. */
export function invoiceTotals(lines: Array<{ quantity: unknown; unitPrice: unknown }>, taxPercent: unknown) {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const subtotal = round2(lines.reduce((sum, l) => sum + round2(num(l.quantity) * num(l.unitPrice)), 0));
  const tax = round2((subtotal * Math.min(num(taxPercent), 100)) / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
}
