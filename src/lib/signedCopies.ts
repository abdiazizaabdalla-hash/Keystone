import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';

/** Most recipients one signature request can fan out to. Keeps one signature from becoming a mass mailing. */
export const MAX_SIGNED_COPY_RECIPIENTS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_COPY_SUBJECT = 'Signed: {{document}} - {{property}}';
export const DEFAULT_COPY_MESSAGE =
  'Hi {{recipient_name}},\n\nAttached is the signed copy of {{document}} for {{property}} (file #{{file_number}}), signed by {{signer}} on {{signed_date}}.\n\nPlease let me know if you need anything else.';

export interface SignedCopyRecipient {
  email: string;
  /** Optional display name, used for the greeting ("Hi Sarah,"). */
  name?: string;
  /** Optional typed title/role such as "Lender" or "Buyer's agent". */
  title?: string;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  return trimmed || undefined;
}

/**
 * Normalizes recipients into {email, name?, title?}. Accepts an array of
 * objects (the form's shape), an array of plain email strings, or one
 * comma/semicolon/whitespace/newline separated string. De-duplicates by
 * email and returns an error message naming the first bad entry.
 */
export function parseRecipients(input: unknown): { recipients: SignedCopyRecipient[]; error?: string } {
  if (input === undefined || input === null || input === '') return { recipients: [] };

  let items: Array<{ email: unknown; name?: unknown; title?: unknown }> = [];
  if (Array.isArray(input)) {
    items = input.map((v) =>
      v && typeof v === 'object'
        ? (v as { email: unknown; name?: unknown; title?: unknown })
        : { email: v }
    );
  } else if (typeof input === 'string') {
    items = input.split(/[\s,;]+/).map((email) => ({ email }));
  } else {
    return { recipients: [], error: 'Recipients must be a list of email addresses' };
  }

  const seen = new Set<string>();
  const recipients: SignedCopyRecipient[] = [];
  for (const item of items) {
    const email = String(item.email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) return { recipients: [], error: `"${email}" is not a valid email address` };
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, name: cleanText(item.name, 100), title: cleanText(item.title, 100) });
  }

  if (recipients.length > MAX_SIGNED_COPY_RECIPIENTS) {
    return { recipients: [], error: `You can send a signed copy to at most ${MAX_SIGNED_COPY_RECIPIENTS} people` };
  }
  return { recipients };
}

/** Replaces {{field}} placeholders. Unknown placeholders are left as-is so a typo is visible, not silently blank. */
export function fillTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = fields[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export interface SignedCopyInput {
  recipients: SignedCopyRecipient[];
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
  const subjectTemplate = input.subjectTemplate?.trim() || DEFAULT_COPY_SUBJECT;
  const messageTemplate = input.messageTemplate?.trim() || DEFAULT_COPY_MESSAGE;

  const renderHtml = (message: string) => `
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
    return { sent: 0, failed: input.recipients.map((r) => r.email) };
  }

  const failed: string[] = [];
  let sent = 0;
  for (const recipient of input.recipients) {
    // Per-recipient fields: a typed name greets them directly; without
    // one the greeting falls back to "there" rather than a blank.
    const fields = {
      ...input.fields,
      recipient_name: recipient.name || 'there',
      recipient_title: recipient.title || '',
    };
    const subject = fillTemplate(subjectTemplate, fields).slice(0, 200);
    const message = fillTemplate(messageTemplate, fields);
    try {
      const result = await resend.emails.send({
        from: INVOICE_FROM_EMAIL,
        to: recipient.email,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        subject,
        html: renderHtml(message),
        attachments: [{ filename: input.signedFileName, content: Buffer.from(input.signedPdf) }],
      });
      if (result.error) throw new Error(result.error.message);
      sent += 1;
    } catch (error) {
      console.error(`Failed to email signed copy to ${recipient.email} (non-fatal):`, error);
      failed.push(recipient.email);
    }
  }
  return { sent, failed };
}
