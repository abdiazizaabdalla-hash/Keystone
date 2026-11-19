import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { sniffLogo } from '@/lib/logoFormat';
import { generateInvoicePdf } from '@/lib/invoicePdf';
import { generateWorkspaceInvoicePdf } from '@/lib/workspaceInvoicePdf';
import { generateCommissionStatementPdf } from '@/lib/commissionStatementPdf';
import { generateComplianceExportPdf } from '@/lib/complianceExportPdf';

// A solid-colour PNG, built by hand so the test needs no image library.
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const logo = png(300, 80, [20, 90, 200]);
const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-';

describe('logo sniffing', () => {
  it('recognises PNG and JPEG by their bytes, not their names', () => {
    expect(sniffLogo(logo)).toBe('png');
    expect(sniffLogo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
  });
  it('refuses anything else', () => {
    expect(sniffLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffLogo(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffLogo(Buffer.alloc(0))).toBeNull();
  });
});

describe('every generated PDF takes a logo', () => {
  const invoice = { invoice_number: 'INV-1', invoice_date: '2026-11-01', due_date: '2026-12-01', amount_owed: 400, paid: false };
  const agent = { name: 'Pat Agent', brokerage: 'Acme Realty', email: 'pat@example.test', phone: null, flat_fee: 400, commission_percent: 0 };
  const tx = { file_number: 'F-1', property_address: '1 Main St', purchase_price: 300000 };

  it('invoice', async () => {
    const without = await generateInvoicePdf(invoice, agent, tx, { name: 'Casey TC', email: 'c@example.test' }, null);
    const withLogo = await generateInvoicePdf(invoice, agent, tx, { name: 'Casey TC', email: 'c@example.test' }, null, logo);
    expect(isPdf(without) && isPdf(withLogo)).toBe(true);
    expect(withLogo.length).toBeGreaterThan(without.length);
  });
  it('invoice survives an unreadable logo', async () => {
    const out = await generateInvoicePdf(invoice, agent, tx, null, null, Buffer.from('not an image'));
    expect(isPdf(out)).toBe(true);
  });
  it('agent invoice', async () => {
    const base = { invoiceNumber: 'W-1', title: 'Referral', issueDate: '2026-11-01', dueDate: null, status: 'sent', memo: null, taxPercent: 0, billTo: { name: 'Client', email: null, address: null }, from: { name: 'Pat', email: null }, lines: [{ description: 'Fee', quantity: 1, unitPrice: 100 }] };
    const a = await generateWorkspaceInvoicePdf(base);
    const b = await generateWorkspaceInvoicePdf(base, logo);
    expect(isPdf(b)).toBe(true);
    expect(b.length).toBeGreaterThan(a.length);
  });
  it('commission statement', async () => {
    const s = { statementNumber: 'S-1', status: 'estimate', property: '1 Main St', fileNumber: null, brokerage: 'Acme', agent: 'Pat', splitText: '70/30', salePrice: 300000, grossPercent: 3, agentPercent: 70, brokeragePercent: 30, gross: 9000, agentShare: 6300, brokerageShare: 2700, deductions: [], agentNet: 6300, brokerageNet: 2700, paidOn: null, paidNote: null };
    const a = await generateCommissionStatementPdf(s);
    const b = await generateCommissionStatementPdf(s, logo);
    expect(isPdf(b)).toBe(true);
    expect(b.length).toBeGreaterThan(a.length);
  });
  it('compliance report', async () => {
    const input = { transaction: { file_number: 'F-1', property_address: '1 Main St', purchase_price: 1, status: 'Closed', acceptance_date: null, closing_date: null, created_at: '2026-11-01T00:00:00Z' }, agent: { name: 'Pat', brokerage: null }, documents: [], messages: [], tasks: [], generatedByName: 'Casey', generatedByEmail: null };
    const a = await generateComplianceExportPdf(input);
    const b = await generateComplianceExportPdf({ ...input, logo });
    expect(isPdf(b)).toBe(true);
    expect(b.length).toBeGreaterThan(a.length);
  });
});
