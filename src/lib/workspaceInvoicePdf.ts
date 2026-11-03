import PDFDocument from 'pdfkit';
import { formatDisplayDate } from './dueDates';
import { invoiceTotals } from './workspaceInvoiceMath';

export interface WorkspaceInvoicePdfInput {
  invoiceNumber: string;
  title: string;
  issueDate: string;
  dueDate: string | null;
  status: string;
  memo: string | null;
  taxPercent: number;
  billTo: { name: string; email: string | null; address: string | null };
  from: { name: string; email: string | null };
  lines: Array<{ description: string; quantity: number; unitPrice: number }>;
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function generateWorkspaceInvoicePdf(inv: WorkspaceInvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fillColor('#08080b').fontSize(22).font('Helvetica-Bold').text(inv.from.name, 56, 56);
      doc.fontSize(10).font('Helvetica').fillColor('#555555').text(inv.from.email || '', 56, 82);
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#08080b').text('INVOICE', 0, 56, { align: 'right' });
      doc.fontSize(10).font('Helvetica').fillColor('#555555').text(inv.invoiceNumber, 0, 82, { align: 'right' });
      doc.moveTo(56, 116).lineTo(556, 116).strokeColor('#dddddd').stroke();

      let y = 136;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('BILL TO', 56, y);
      doc.text('ISSUED', 340, y);
      doc.text('DUE', 460, y);
      y += 14;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#08080b').text(inv.billTo.name || '—', 56, y, { width: 260 });
      doc.fontSize(10).font('Helvetica').fillColor('#333333').text(formatDisplayDate(inv.issueDate), 340, y);
      doc.text(inv.dueDate ? formatDisplayDate(inv.dueDate) : 'On receipt', 460, y);
      y += 16;
      for (const part of [inv.billTo.email, inv.billTo.address]) {
        if (part) {
          doc.fontSize(10).font('Helvetica').fillColor('#555555').text(part, 56, y, { width: 260 });
          y = doc.y + 2;
        }
      }

      y += 20;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 16;
      if (inv.title) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#08080b').text(inv.title, 56, y, { width: 500 });
        y = doc.y + 12;
      }

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('DESCRIPTION', 56, y);
      doc.text('QTY', 330, y, { width: 40, align: 'right' });
      doc.text('PRICE', 380, y, { width: 80, align: 'right' });
      doc.text('AMOUNT', 466, y, { width: 90, align: 'right' });
      y += 16;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#eeeeee').stroke();
      y += 10;

      for (const l of inv.lines) {
        if (y > 680) {
          doc.addPage();
          y = 56;
        }
        doc.fontSize(10).font('Helvetica').fillColor('#333333').text(l.description || '', 56, y, { width: 260 });
        const rowBottom = doc.y;
        doc.text(String(l.quantity), 330, y, { width: 40, align: 'right' });
        doc.text(money(l.unitPrice), 380, y, { width: 80, align: 'right' });
        doc.text(money(l.quantity * l.unitPrice), 466, y, { width: 90, align: 'right' });
        y = Math.max(rowBottom, y + 14) + 8;
      }

      const totals = invoiceTotals(inv.lines, inv.taxPercent);
      y += 6;
      doc.moveTo(330, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 10;
      const row = (label: string, value: string, bold = false) => {
        doc.fontSize(bold ? 12 : 10).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#08080b');
        doc.text(label, 330, y, { width: 130, align: 'right' });
        doc.text(value, 466, y, { width: 90, align: 'right' });
        y += bold ? 20 : 16;
      };
      row('Subtotal', money(totals.subtotal));
      if (inv.taxPercent > 0) row(`Tax (${inv.taxPercent}%)`, money(totals.tax));
      row('Total due', money(totals.total), true);

      if (inv.status === 'paid') {
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#15803d').text('PAID', 56, y + 4);
        y += 28;
      }
      if (inv.memo) {
        y += 12;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('NOTES', 56, y);
        y += 14;
        doc.fontSize(10).font('Helvetica').fillColor('#333333').text(inv.memo, 56, y, { width: 500 });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
