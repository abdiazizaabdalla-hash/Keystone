import PDFDocument from 'pdfkit';
import { drawLogo } from './pdfLetterhead';

export interface StatementInput {
  statementNumber: string;
  status: string;
  property: string;
  fileNumber: string | null;
  brokerage: string;
  agent: string;
  splitText: string;
  salePrice: number | null;
  /** The gross as a percent of the sale price, when there is a price. */
  grossPercent: number | null;
  agentPercent: number | null;
  brokeragePercent: number | null;
  gross: number;
  agentShare: number;
  brokerageShare: number;
  deductions: { label: string; amount: number }[];
  agentNet: number;
  brokerageNet: number;
  paidOn: string | null;
  paidNote: string | null;
}

const money = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function generateCommissionStatementPdf(s: StatementInput, logo?: Buffer | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dy = drawLogo(doc, logo);
      doc.fillColor('#08080b').fontSize(22).font('Helvetica-Bold').text(s.brokerage, 56, 56 + dy, { width: 330 });
      doc.fontSize(20).font('Helvetica-Bold').text('COMMISSION STATEMENT', 300, 56 + dy, { align: 'right', width: 256 });
      doc.fontSize(10).font('Helvetica').fillColor('#555555').text(s.statementNumber, 300, 84 + dy, { align: 'right', width: 256 });
      doc.moveTo(56, 124 + dy).lineTo(556, 124 + dy).strokeColor('#dddddd').stroke();

      let y = 142 + dy;
      const label = (t: string, x: number) => doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text(t, x, y);
      label('AGENT', 56);
      label('PROPERTY', 260);
      y += 14;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#08080b').text(s.agent, 56, y, { width: 190 });
      doc.fontSize(11).font('Helvetica').fillColor('#333333').text(s.property || '—', 260, y, { width: 296 });
      y = Math.max(doc.y, y + 16) + 4;
      if (s.fileNumber) {
        doc.fontSize(10).fillColor('#555555').text(`File ${s.fileNumber}`, 260, y);
        y = doc.y + 4;
      }
      y += 18;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 16;

      const row = (name: string, value: string, bold = false, color = '#08080b') => {
        doc.fontSize(bold ? 12 : 10.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
        doc.text(name, 56, y, { width: 330 });
        doc.text(value, 396, y, { width: 160, align: 'right' });
        y += bold ? 22 : 18;
      };
      if (s.salePrice) row('Sale price', money(s.salePrice));
      row('Gross commission received by the brokerage', money(s.gross), true);
      if (s.salePrice && s.grossPercent !== null) row(`That is ${s.grossPercent}% of the sale price`, '', false, '#555555');
      row(`Split: ${s.splitText}`, '', false, '#555555');
      row(s.agentPercent !== null ? `Agent share (${s.agentPercent}% of the gross)` : 'Agent share', money(s.agentShare));
      row(s.brokeragePercent !== null ? `Brokerage share (${s.brokeragePercent}% of the gross)` : 'Brokerage share', money(s.brokerageShare));
      if (s.deductions.length > 0) {
        y += 6;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('FEES CHARGED TO THE AGENT', 56, y);
        y += 16;
        for (const d of s.deductions) row(d.label, `− ${money(d.amount)}`);
      }
      y += 6;
      doc.moveTo(300, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 12;
      row('Net to agent', money(s.agentNet), true);
      row('Net to brokerage', money(s.brokerageNet), true);

      y += 14;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(s.status === 'paid' ? '#15803d' : '#555555').text(`Status: ${s.status === 'paid' ? 'Paid' : s.status === 'accepted' ? 'Agreed, not yet paid' : s.status === 'void' ? 'Void' : 'Awaiting the agent’s agreement'}`, 56, y);
      y += 16;
      if (s.paidOn) {
        doc.fontSize(10).font('Helvetica').fillColor('#333333').text(`Paid on ${s.paidOn}${s.paidNote ? `: ${s.paidNote}` : ''}`, 56, y, { width: 500 });
        y = doc.y + 8;
      }
      y += 16;
      doc.fontSize(8).font('Helvetica').fillColor('#888888').text('This statement records the split agreed between the brokerage and the agent for this deal. It is not a tax document. Payment is made outside Relay unless stated otherwise.', 56, y, { width: 500 });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
