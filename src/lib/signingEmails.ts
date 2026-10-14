import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';

// The "please sign this" email -- sent when a request is created (to the
// first signer) and again when it becomes the next signer's turn.
export async function sendSigningRequestEmail(input: {
  to: string;
  signerName: string;
  fileName: string;
  propertyAddress: string;
  fileNumber: string;
  signUrl: string;
  /** Set for signers after the first: who just finished, and where this person is in the order. */
  previousSignerName?: string;
  position?: { index: number; total: number };
}): Promise<void> {
  const resend = getResendClient();
  const first = input.signerName.trim().split(' ')[0] || input.signerName.trim();
  const turnLine = input.previousSignerName
    ? `<p>${escapeHtml(input.previousSignerName)} has signed, and now it's your turn.</p>`
    : '';
  const positionLine =
    input.position && input.position.total > 1
      ? `<p style="font-size: 13px; color: #666;">You are signer ${input.position.index} of ${input.position.total}.</p>`
      : '';
  await resend.emails.send({
    from: INVOICE_FROM_EMAIL,
    to: input.to,
    subject: `Signature requested: ${input.fileName}`,
    html: `
      <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${escapeHtml(first)},</p>
        ${turnLine}
        <p>You've been asked to sign <strong>${escapeHtml(input.fileName)}</strong> for ${escapeHtml(input.propertyAddress)} (file #${escapeHtml(input.fileNumber)}).</p>
        <p><a href="${input.signUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Review &amp; Sign</a></p>
        ${positionLine}
        <p style="font-size: 13px; color: #666;">Or paste this link into your browser: ${input.signUrl}</p>
      </div>
    `,
  });
}
