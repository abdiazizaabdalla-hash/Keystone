import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';

/** Most recipients one signature request can fan out to. Keeps one signature from becoming a mass mailing. */
export const MAX_SIGNED_COPY_RECIPIENTS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_COPY_SUBJECT = 'Signed: {{document}} - {{property}}';
export const DEFAULT_COPY_MESSAGE =
  'Hi,\n\nAttached is the signed copy of {{document}} for {{property}} (file #{{file_number}}), signed by {{signer}} on {{signed_date}}.\n\nPlease let me know if you need anything else.';

/**
 * Parses a comma/semicolon/whitespace/newline separated list (or an array)
 * of email addresses. Returns the cleaned, de-duplicated list or an error
 * message naming the first bad entry.
 */
export function parseRecipientList(input: unknown): { emails: string[]; error?: string } {
  if (input === undefined || input === null || input === '') return { emails: [] };

  const raw: string[] = Array.isArray(input)
    ? input.map((v) => String(v))
    : typeof input === 'string'
      ? input.split(/[\s,;]+/)
      : [];

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const piece of raw) {
    const email = piece.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) return { emails: [], error: `"${piece.trim()}" is not a valid email address` };
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }

  if (emails.length > MAX_SIGNED_COPY_RECIPIENTS) {
    return { emails: [], error: `You can send a signed copy to at most ${MAX_SIGNED_COPY_RECIPIENTS} people` };
  }
  return { emails };
}

/** Replaces {{field}} placeholders. Unknown placeholders are left as-is so a typo is visible, not silently blank. */
export function fillTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = fields[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export interface SignedCopyInput {
  recipients: string[];
  subjectTemplate: string | null;
  messageTemplate: string | null;
  replyTo: string | null;
  signedPdf: Uint8Array | Buffer;
  signedFileName: string;
  fields: {
    document: string;
    property: string;
    file_number: string;
    signer: string;
    signed_date: string;
  };
}

/**
 * Emails the signed PDF to each recipient individually (one message each,
 * so nobody sees anyone else's address). Returns which sends failed;
 * never throws -- a failed copy must not undo a completed signature.
 */
export async function sendSignedCopies(input: SignedCopyInput): Promise<{ sent: number; failed: string[] }> {
  const subject = fillTemplate(input.subjectTemplate?.trim() || DEFAULT_COPY_SUBJECT, input.fields).slice(0, 200);
  const message = fillTemplate(input.messageTemplate?.trim() || DEFAULT_COPY_MESSAGE, input.fields);

  const html = `
    <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
      ${escapeHtml(message)
        .split(/\n{2,}/)
        .map((para) => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
        .join('')}
      <p style="font-size: 12px; color: #888;">Sent via Relay TC</p>
    </div>
  `;

  let resend;
  try {
    resend = getResendClient();
  } catch (error) {
    console.error('Signed copies not sent -- email is not configured:', error);
    return { sent: 0, failed: input.recipients };
  }

  const failed: string[] = [];
  let sent = 0;
  for (const to of input.recipients) {
    try {
      const result = await resend.emails.send({
        from: INVOICE_FROM_EMAIL,
        to,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        subject,
        html,
        attachments: [{ filename: input.signedFileName, content: Buffer.from(input.signedPdf) }],
      });
      if (result.error) throw new Error(result.error.message);
      sent += 1;
    } catch (error) {
      console.error(`Failed to email signed copy to ${to} (non-fatal):`, error);
      failed.push(to);
    }
  }
  return { sent, failed };
}
