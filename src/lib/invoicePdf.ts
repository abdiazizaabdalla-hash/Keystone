import PDFDocument from 'pdfkit';
import { formatPhoneNumber } from './formatPhone';
import { formatDisplayDate } from './dueDates';
import { drawLogo } from './pdfLetterhead';
import { invoiceBreakdown, type BreakdownInvoice } from './invoiceBreakdown';

interface AgentInfo {
  name: string;
  brokerage: string | null;
  email: string | null;
  phone: string | null;
  flat_fee: number;
  commission_percent: number;
}

interface TransactionInfo {
  file_number: string;
  property_address: string;
  purchase_price: number;
  /** A listing invoice: the property's list price is shown instead of a file number and purchase price. */
  isListing?: boolean;
}

interface InvoiceInfo extends Partial<BreakdownInvoice> {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount_owed: number;
  paid: boolean;
}

export interface TcInfo {
  name: string;
  email: string | null;
}

export function generateInvoicePdf(
  invoice: InvoiceInfo,
  agent: AgentInfo,
  transaction: TransactionInfo,
  tc?: TcInfo | null,
  payUrl?: string | null,
  logo?: Buffer | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const money = (n: number) =>
        `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const dateStr = (d: string) => formatDisplayDate(d);

      // Header -- the TC themselves is the primary identity on their own
      // invoice (this used to be hardcoded to "Relay TC", the product's
      // own branding, which left the agent unsure who they were actually
      // paying). Falls back to the "Relay TC" label only if the TC never
      // set a display name in Settings.
      const dy = drawLogo(doc, logo);
      const billerName = tc?.name || 'Relay TC';
      doc
        .fillColor('#08080b')
        .fontSize(22)
        .font('Helvetica-Bold')
        .text(billerName, 56, 56 + dy);
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#555555')
        .text(tc?.email || 'Transaction Coordination Services', 56, 82 + dy);

      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .fillColor('#08080b')
        .text('INVOICE', 0, 56 + dy, { align: 'right' });
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#555555')
        .text(invoice.invoice_number, 0, 82 + dy, { align: 'right' });

      doc.moveTo(56, 116 + dy).lineTo(556, 116 + dy).strokeColor('#dddddd').stroke();

      let y = 136 + dy;

      // Bill To / dates
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('BILL TO', 56, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('INVOICE DATE', 340, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('DUE DATE', 460, y);

      y += 14;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#08080b').text(agent.name, 56, y);
      doc.fontSize(10).font('Helvetica').fillColor('#333333').text(dateStr(invoice.invoice_date), 340, y);
      doc.fontSize(10).font('Helvetica').fillColor('#333333').text(dateStr(invoice.due_date), 460, y);

      y += 16;
      if (agent.brokerage) {
        doc.fontSize(10).font('Helvetica').fillColor('#555555').text(agent.brokerage, 56, y);
        y += 14;
      }
      if (agent.email) {
        doc.fontSize(10).font('Helvetica').fillColor('#555555').text(agent.email, 56, y);
        y += 14;
      }
      if (agent.phone) {
        doc.fontSize(10).font('Helvetica').fillColor('#555555').text(formatPhoneNumber(agent.phone), 56, y);
        y += 14;
      }

      y += 20;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 20;

      // Transaction details
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('PROPERTY', 56, y);
      y += 14;
      doc.fontSize(11).font('Helvetica').fillColor('#08080b').text(transaction.property_address, 56, y, { width: 500 });
      y += 20;
      if (transaction.isListing) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('LISTING PRICE', 56, y);
        y += 14;
        doc.fontSize(11).font('Helvetica').fillColor('#08080b').text(transaction.purchase_price ? money(transaction.purchase_price) : 'Not set', 56, y);
      } else {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('FILE NUMBER', 56, y);
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('PURCHASE PRICE', 340, y);
        y += 14;
        doc.fontSize(11).font('Helvetica').fillColor('#08080b').text(transaction.file_number, 56, y);
        doc.fontSize(11).font('Helvetica').fillColor('#08080b').text(money(transaction.purchase_price), 340, y);
      }

      y += 40;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 20;

      // Fee breakdown table
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('DESCRIPTION', 56, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('AMOUNT', 460, y, { width: 96, align: 'right' });
      y += 16;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#eeeeee').stroke();
      y += 12;

      const breakdown = invoiceBreakdown({ ...invoice, kind: transaction.isListing ? 'listing' : invoice.kind }, agent, transaction.purchase_price);
      for (const line of breakdown.lines) {
        doc.fontSize(10).font('Helvetica').fillColor('#333333').text(line.label, 56, y, { width: 390 });
        doc.fontSize(10).font('Helvetica').fillColor(line.amount < 0 ? '#1a7f37' : '#333333').text(line.amount < 0 ? `-${money(Math.abs(line.amount))}` : money(line.amount), 460, y, { width: 96, align: 'right' });
        y += 20;
      }

      y += 8;
      doc.moveTo(340, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 14;

      doc.fontSize(12).font('Helvetica-Bold').fillColor('#08080b').text('Total Due', 340, y);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#08080b').text(money(invoice.amount_owed), 460, y, { width: 96, align: 'right' });

      y += 30;
      if (invoice.paid) {
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#1a7f37')
          .text('PAID', 460, y, { width: 96, align: 'right' });
        y += 20;
      }

      // Pay Online — only shown when the TC has an online payment method
      // connected and a fresh link was generated for this document, and
      // only while unpaid. Anything not paid online is handled manually
      // by the TC (Zelle, Venmo, a check, etc., off-platform) and just
      // marked paid here once the money's actually received.
      if (payUrl && !invoice.paid) {
        y += 4;
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#1f4d8a')
          .text('PAY ONLINE', 56, y);
        y += 14;
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor('#1f4d8a')
          .text(payUrl, 56, y, { width: 500, link: payUrl, underline: true });
        y += 20;
      }

      // Footer
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#888888')
        .text('Thank you for the referral. Please remit payment by the due date above.', 56, Math.max(y, 700), { width: 500, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
