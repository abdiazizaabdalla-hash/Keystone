import PDFDocument from 'pdfkit';

/** A plain letter on US Letter paper: a heading line, then the text. Used to save a filled-in letter template. */
export function generateLetterPdf(title: string, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (title.trim()) {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111').text(title.trim(), { align: 'left' });
      doc.moveDown(1);
    }
    doc.font('Helvetica').fontSize(11).fillColor('#111111').text(text, { align: 'left', lineGap: 3 });
    doc.end();
  });
}
