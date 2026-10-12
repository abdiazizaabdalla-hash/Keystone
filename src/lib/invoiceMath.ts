// One definition of "money received" shared by the dashboard and the
// Invoices page, so the two can't drift apart again: what was actually paid
// (paid_amount when recorded, otherwise the invoice amount), minus any
// refund. Unpaid and refunded-unpaid invoices count as zero.

export interface InvoiceMoney {
  paid: boolean;
  amount_owed: number;
  paid_amount?: number | null;
  refunded_amount?: number | null;
  paid_at?: string | null;
}

export function netReceived(inv: InvoiceMoney): number {
  if (!inv.paid) return 0;
  const gross = inv.paid_amount ?? inv.amount_owed ?? 0;
  return gross - (inv.refunded_amount || 0);
}

/** True when the invoice was paid within the given calendar month (local time). */
export function paidInMonth(inv: InvoiceMoney, monthStart: Date, nextMonthStart: Date): boolean {
  if (!inv.paid || !inv.paid_at) return false;
  const d = new Date(inv.paid_at);
  return d >= monthStart && d < nextMonthStart;
}
