import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** A long, random, unguessable opaque token -- this is the ONLY auth on the public /sign/[token] page and its API route, so treat it like a bearer credential. */
export function generateSigningToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a document's raw bytes, captured at request time so the audit trail can prove exactly which version of the file was sent out for signature. */
export function hashDocumentBytes(bytes: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export interface SignatureCertificateInput {
  pdfBytes: Uint8Array | Buffer;
  signerName: string;
  signerEmail: string;
  signedAtIso: string;
  signerIp: string | null;
  documentHash: string;
  signatureType: 'typed' | 'drawn';
  /** Typed signature: the plain text. Drawn signature: a `data:image/png;base64,...` string from the signing page's canvas. */
  signatureValue: string;
}

/**
 * Appends a new final "Signature Certificate" page to the given PDF,
 * carrying the signature itself plus the audit-trail details (signer,
 * timestamp, IP, original-document hash). This is the same pattern
 * DocuSign and other e-signature vendors use for their own certificate
 * page -- v1 deliberately doesn't support placing the signature at a
 * specific spot on a specific page (see the migration note in
 * database-schema.sql), which would need a PDF-coordinate-picking UI.
 */
export async function stampSignatureCertificate(input: SignatureCertificateInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(input.pdfBytes);
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const marginX = 60;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let y = height - 90;

  page.drawText('Signature Certificate', { x: marginX, y, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 50;

  if (input.signatureType === 'drawn' && input.signatureValue.startsWith('data:image/png')) {
    const base64 = input.signatureValue.split(',')[1] || '';
    const imageBytes = Buffer.from(base64, 'base64');
    const image = await pdfDoc.embedPng(imageBytes);
    const imgWidth = 220;
    const imgHeight = (image.height / image.width) * imgWidth || 80;
    page.drawImage(image, { x: marginX, y: y - imgHeight, width: imgWidth, height: imgHeight });
    y -= imgHeight + 15;
  } else {
    page.drawText(input.signatureValue || input.signerName, {
      x: marginX,
      y: y - 26,
      size: 26,
      font: italicFont,
      color: rgb(0.12, 0.12, 0.45),
    });
    y -= 55;
  }

  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + 240, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= 24;

  const detailLines = [
    `Signed by: ${input.signerName} <${input.signerEmail}>`,
    `Date: ${new Date(input.signedAtIso).toLocaleString('en-US', { timeZoneName: 'short' })}`,
    `IP address: ${input.signerIp || 'unknown'}`,
    `Document hash (SHA-256): ${input.documentHash}`,
  ];
  for (const line of detailLines) {
    page.drawText(line, { x: marginX, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 16;
  }

  y -= 16;
  const disclaimerLines = [
    "This certificate was generated electronically by Relay TC and reflects the signer's",
    'consent to sign this document electronically, in accordance with the U.S. ESIGN',
    'Act and UETA (Uniform Electronic Transactions Act).',
  ];
  for (const line of disclaimerLines) {
    page.drawText(line, { x: marginX, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 12;
  }

  return pdfDoc.save();
}
