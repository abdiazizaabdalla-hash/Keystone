import { getResendClient, INVOICE_FROM_EMAIL } from './resendClient';
import { escapeHtml } from './escapeHtml';
import { supabaseServer } from './supabase';

// One place that sends an email from a deal on someone's behalf (used by templates and, later, automation).
// The message goes out under the person's name from Relay's sending address; replies go to the deal's own inbound
// address when there is one (so they are filed on the deal) and otherwise to the person. With RELAY_OUTBOX_ONLY=1 it
// is written to the email_outbox table instead of being sent, which is how everything runs on a developer machine.

export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function outboxOnly(): boolean {
  return process.env.RELAY_OUTBOX_ONLY === '1';
}

export function plainToHtml(text: string, signature: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1f;">${paragraphs}` +
    `<p style="margin:22px 0 0;font-size:12px;color:#7a7a85;">${escapeHtml(signature)}</p></div>`
  );
}

export interface DealEmail {
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string | null;
  transactionId: string;
  to: string[];
  subject: string;
  message: string;
  /** Copy the sender so it lands in their own inbox. */
  copySender?: boolean;
  /** Where this came from, for the outbox: 'template' (a person pressed send) or 'rule' (automation). */
  source: string;
}

export async function dealInboundAddress(transactionId: string): Promise<string | null> {
  const domain = process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN;
  if (!domain) return null;
  const { data } = await supabaseServer.from('transactions').select('inbound_token').eq('id', transactionId).maybeSingle();
  return data?.inbound_token ? `deal-${data.inbound_token as string}@${domain}` : null;
}

export async function sendDealEmail(input: DealEmail): Promise<{ mode: 'sent' | 'outbox'; loggedToDeal: boolean }> {
  const to = [...new Set(input.to.map((a) => a.trim().toLowerCase()))].filter((a) => EMAIL_RE.test(a));
  if (to.length === 0) throw new Error('No valid recipients');
  const dealAddress = await dealInboundAddress(input.transactionId);
  const replyTo = dealAddress ?? input.ownerEmail ?? undefined;
  const cc = input.copySender && input.ownerEmail ? [input.ownerEmail] : [];
  const bcc = dealAddress ? [dealAddress] : [];

  if (outboxOnly()) {
    const { error } = await supabaseServer.from('email_outbox').insert({
      owner_user_id: input.ownerUserId,
      transaction_id: input.transactionId,
      source: input.source,
      to_emails: to,
      cc_emails: cc,
      bcc_emails: bcc,
      reply_to: replyTo ?? null,
      from_name: input.ownerName,
      subject: input.subject,
      body: input.message,
    });
    if (error) throw error;
    return { mode: 'outbox', loggedToDeal: Boolean(dealAddress) };
  }

  const fromAddress = INVOICE_FROM_EMAIL.match(/<([^>]+)>/)?.[1] ?? INVOICE_FROM_EMAIL;
  const safeName = input.ownerName.replace(/["<>\r\n,;]/g, '').slice(0, 60);
  const signature = `Sent by ${input.ownerName} using Relay TC. Reply to this email to reach them directly.`;
  const { error } = await getResendClient().emails.send({
    from: `${safeName} via Relay TC <${fromAddress}>`,
    to,
    ...(cc.length ? { cc } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject: input.subject,
    html: plainToHtml(input.message, signature),
    text: `${input.message}\n\n-- ${signature}`,
  });
  if (error) {
    console.error('Resend rejected a deal email:', error);
    throw new Error('The email could not be sent. Please try again.');
  }
  return { mode: 'sent', loggedToDeal: Boolean(dealAddress) };
}
