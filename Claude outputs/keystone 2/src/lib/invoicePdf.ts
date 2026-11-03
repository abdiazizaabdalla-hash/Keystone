import PDFDocument from 'pdfkit';
import { formatPhoneNumber } from './formatPhone';

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
}

interface InvoiceInfo {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount_owed: number;
  paid: boolean;
}

export interface ZellePaymentInfo {
  contact: string;
  displayName: string;
  qrDataUrl: string;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1] || '';
  return Buffer.from(base64, 'base64');
}

export function generateInvoicePdf(
  invoice: InvoiceInfo,
  agent: AgentInfo,
  transaction: TransactionInfo,
  zelle?: ZellePaymentInfo | null,
  helcimPayUrl?: string | null
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
      const dateStr = (d: string) =>
        new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Header
      doc
        .fillColor('#08080b')
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('Relay TC', 56, 56);
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#555555')
        .text('Transaction Coordination Services', 56, 82);

      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .fillColor('#08080b')
        .text('INVOICE', 0, 56, { align: 'right' });
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#555555')
        .text(invoice.invoice_number, 0, 82, { align: 'right' });

      doc.moveTo(56, 116).lineTo(556, 116).strokeColor('#dddddd').stroke();

      // Bill To / dates
      let y = 134;
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
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('FILE NUMBER', 56, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('PURCHASE PRICE', 340, y);
      y += 14;
      doc.fontSize(11).font('Helvetica').fillColor('#08080b').text(transaction.file_number, 56, y);
      doc.fontSize(11).font('Helvetica').fillColor('#08080b').text(money(transaction.purchase_price), 340, y);

      y += 40;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#dddddd').stroke();
      y += 20;

      // Fee breakdown table
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('DESCRIPTION', 56, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text('AMOUNT', 460, y, { width: 96, align: 'right' });
      y += 16;
      doc.moveTo(56, y).lineTo(556, y).strokeColor('#eeeeee').stroke();
      y += 12;

      const flatFee = agent.flat_fee || 0;
      const percentAmount = ((transaction.purchase_price || 0) * (agent.commission_percent || 0)) / 100;

      doc.fontSize(10).font('Helvetica').fillColor('#333333').text('Transaction coordination fee (flat)', 56, y);
      doc.fontSize(10).font('Helvetica').fillColor('#333333').text(money(flatFee), 460, y, { width: 96, align: 'right' });
      y += 20;

      if (agent.commission_percent) {
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor('#333333')
          .text(`Percentage fee (${agent.commission_percent}%)`, 56, y);
        doc.fontSize(10).font('Helvetica').fillColor('#333333').text(money(percentAmount), 460, y, { width: 96, align: 'right' });
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

      // Payment instructions (Zelle) — only shown when the TC has it
      // enabled and only when the invoice isn't already paid.
      if (zelle && !invoice.paid) {
        y += 10;
        const boxTop = y;
        const boxHeight = 96;
        doc.roundedRect(56, boxTop, 500, boxHeight, 6).fillColor('#faf6ec').fill();
        doc
          .roundedRect(56, boxTop, 500, boxHeight, 6)
          .strokeColor('#e8dcb8')
          .lineWidth(1)
          .stroke();

        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#8a6d1f')
          .text('PAY WITH ZELLE', 76, boxTop + 14);
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#08080b')
          .text(zelle.displayName || 'Relay TC', 76, boxTop + 30);
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor('#333333')
          .text(zelle.contact, 76, boxTop + 48);
        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor('#777777')
          .text('Scan with your banking app, or send Zelle to the contact above.', 76, boxTop + 66, { width: 320 });

        try {
          doc.image(dataUrlToBuffer(zelle.qrDataUrl), 480, boxTop + 10, { width: 60, height: 60 });
        } catch {
          // If the QR image fails to embed for any reason, the text
          // instructions above are still enough to pay — don't fail the
          // whole PDF over a decorative QR code.
        }

        y = boxTop + boxHeight + 16;
      }

      // Pay Online (Helcim) — separate from Zelle above, only shown when
      // the TC has connected and generated a link, and only while unpaid.
      if (helcimPayUrl && !invoice.paid) {
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
          .text(helcimPayUrl, 56, y, { width: 500, link: helcimPayUrl, underline: true });
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
