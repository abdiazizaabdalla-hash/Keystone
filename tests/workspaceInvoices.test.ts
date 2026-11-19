import { describe, expect, it } from 'vitest';
import { invoiceTotals } from '@/lib/workspaceInvoiceMath';
import { INVOICE_TEMPLATES, getInvoiceTemplate } from '@/lib/workspaceInvoiceTemplates';

describe('invoiceTotals', () => {
  it('adds lines and rounds to cents', () => {
    expect(invoiceTotals([{ quantity: 3, unitPrice: 33.333 }, { quantity: 1, unitPrice: 10 }], 0)).toEqual({ subtotal: 110, tax: 0, total: 110 });
  });
  it('applies tax to the subtotal', () => {
    expect(invoiceTotals([{ quantity: 2, unitPrice: 100 }], 8.25)).toEqual({ subtotal: 200, tax: 16.5, total: 216.5 });
  });
  it('treats negative, missing or non-numeric input as zero and caps tax at 100%', () => {
    expect(invoiceTotals([{ quantity: -2, unitPrice: 50 }, { quantity: 'x', unitPrice: 5 }], 500)).toEqual({ subtotal: 0, tax: 0, total: 0 });
    expect(invoiceTotals([{ quantity: 1, unitPrice: 10 }], 500)).toEqual({ subtotal: 10, tax: 10, total: 20 });
  });
});

describe('invoice templates', () => {
  it('has unique keys, a blank starting point and at least ten choices', () => {
    const keys = INVOICE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('blank');
    expect(INVOICE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });
  it('every template has a title, a line and a sensible due period', () => {
    for (const t of INVOICE_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.lines.length).toBeGreaterThan(0);
      expect(t.dueInDays).toBeGreaterThanOrEqual(0);
    }
  });
  it('falls back to blank for an unknown key', () => {
    expect(getInvoiceTemplate('nope').key).toBe('blank');
    expect(getInvoiceTemplate(null).key).toBe('blank');
  });
});
