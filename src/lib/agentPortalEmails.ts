import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';
import { outboxOnly } from '@/lib/dealEmail';
import { supabaseServer } from '@/lib/supabase';

/** An email that could not be sent (Resend refused it, or the key is missing). Callers already treat a failed send as an error. */
export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/** Plain-text version of one of these emails, for the test outbox. Links are kept as "label (url)". */
export function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|h2|div)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The one place these emails leave the app. Resend reports a refused send (bad key, unverified sending domain,
// invalid address) as { error } instead of throwing, so the result is checked here and a failure is thrown: nothing
// can say "sent" about an email that was not. With RELAY_OUTBOX_ONLY=1 (a developer machine) nothing is sent: the
// email is recorded in email_outbox under `ownerUserId` (when given) so it can be read in the test outbox.
export async function deliverEmail(email: {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** What kind of email this is, for the outbox and the logs. */
  source: string;
  /** Whose test outbox it lands in. */
  ownerUserId?: string;
}): Promise<void> {
  if (outboxOnly()) {
    if (!email.ownerUserId) {
      console.info(`[outbox] ${email.source} to ${email.to}: ${email.subject}`);
      return;
    }
    const { error } = await supabaseServer.from('email_outbox').insert({
      owner_user_id: email.ownerUserId,
      source: email.source,
      to_emails: [email.to],
      reply_to: email.replyTo ?? null,
      from_name: 'Relay TC',
      subject: email.subject,
      body: htmlToText(email.html),
    });
    if (error) {
      console.error('Could not record an email in the test outbox:', error);
      throw new EmailDeliveryError('The email could not be recorded in the test outbox.');
    }
    return;
  }
  let result;
  try {
    result = await getResendClient().emails.send({
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    });
  } catch (err) {
    console.error(`Could not send a ${email.source} email:`, err);
    throw new EmailDeliveryError('The email could not be sent.');
  }
  if (result.error) {
    console.error(`Resend rejected a ${email.source} email:`, result.error);
    throw new EmailDeliveryError('The email could not be sent.');
  }
}

const wrapper = (title: string, bodyHtml: string) => `
  <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px; margin: 0 auto;">
    <h2 style="margin: 0 0 16px;">${escapeHtml(title)}</h2>
    ${bodyHtml}
    <p style="margin-top: 24px;">Thanks,<br/>Relay TC</p>
  </div>
`;

// One email, one link -- the login link is generated server-side (see
// POST /api/agent-invites, which calls supabaseServer.auth.admin.generateLink
// instead of signInWithOtp) and embedded directly below as the primary
// call to action, so this is the only email an invited agent gets. No
// password needed; clicking it signs them straight in.
export async function sendAgentInviteEmail(params: {
  toEmail: string;
  tcLabel: string;
  propertyAddress: string | null;
  loginUrl: string;
  fromListing?: boolean;
  /** Whose test outbox it lands in when RELAY_OUTBOX_ONLY=1: the person sending the invitation. */
  ownerUserId?: string;
}) {
  const { toEmail, tcLabel, propertyAddress, loginUrl, fromListing, ownerUserId } = params;
  const dealLabel = propertyAddress ? `for ${propertyAddress}` : 'on Relay TC';
  const where = propertyAddress ? `at ${propertyAddress}` : '';
  const html = wrapper(
    fromListing ? 'Your listing is now an active transaction' : "You've been added to a deal",
    fromListing
      ? `<p>Your listing ${escapeHtml(where)} is now under contract. <strong>${escapeHtml(tcLabel)}</strong> set it up as a transaction on Relay TC,
     and it is already on your dashboard.</p>`
      : `<p><strong>${escapeHtml(tcLabel)}</strong> added you ${escapeHtml(dealLabel)} on Relay TC, a transaction coordination
     workspace.</p>
     <p><a href="${loginUrl}" style="color: #b45309;">Set up your Relay TC account</a></p>
     <p style="font-size: 13px; color: #555;">This link doesn't expire. It takes you to a page that emails you a fresh sign-in link when you ask for one.</p>
     <p>Once in, you'll be able to see the deal's checklist, upload and download documents, and
     message ${tcLabel} right from the page.</p>`
  );

  return deliverEmail({ source: 'sendAgentInviteEmail', ownerUserId,
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: fromListing ? `Your listing${propertyAddress ? ` at ${propertyAddress}` : ''} is now an active transaction` : `${tcLabel} added you to a deal on Relay TC`,
    html,
  });
}

// An agent with their own workspace asking a coordinator to run a deal with them. The coordinator signs in (or signs up)
// to their normal Relay TC account with this address and accepts from the transactions page; nothing here signs anyone in.
export async function sendTcInviteEmail(params: {
  toEmail: string;
  agentLabel: string;
  propertyAddress: string | null;
  appUrl: string;
  /** False when the agent said this coordinator is not on Relay TC yet. */
  usesRelay?: boolean;
  /** Whose test outbox it lands in when RELAY_OUTBOX_ONLY=1: the person sending the invitation. */
  ownerUserId?: string;
}) {
  const { toEmail, agentLabel, propertyAddress, appUrl, usesRelay = true, ownerUserId } = params;
  const dealLabel = propertyAddress ? `the deal at ${propertyAddress}` : 'a deal';
  const html = wrapper(
    "You've been invited to coordinate a deal",
    usesRelay
      ? `<p><strong>${escapeHtml(agentLabel)}</strong> invited you to coordinate ${escapeHtml(dealLabel)} on Relay TC.</p>
     <p><a href="${appUrl}/auth" style="color: #b45309;">Sign in to Relay TC</a> with this email address, then accept the invitation at the top of your Transactions page.</p>
     <p style="font-size: 13px; color: #555;">Once you accept, the deal shows up in your normal transaction list and you can work it like any other.</p>`
      : `<p><strong>${escapeHtml(agentLabel)}</strong> would like you to coordinate ${escapeHtml(dealLabel)} and invited you to do it on Relay TC, a workspace for transaction coordinators: checklist, documents, messages and key dates in one place, shared with the agent.</p>
     <p><a href="${appUrl}/auth" style="color: #b45309;">Create your Relay TC account</a> with this email address, then accept the invitation at the top of your Transactions page.</p>
     <p style="font-size: 13px; color: #555;">If you were not expecting this, you can ignore the email. Nothing is shared with you until you accept.</p>`
  );
  return deliverEmail({ source: 'sendTcInviteEmail', ownerUserId,
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${agentLabel} invited you to coordinate a deal on Relay TC`,
    html,
  });
}

// The sign-in link an agent asks for on /agent/login. Works for `minutes` minutes and can be opened more than once,
// so a mail app or security scanner opening it first does not use it up.
export async function sendAgentLoginLinkEmail(params: { toEmail: string; loginUrl: string; minutes: number }) {
  const { toEmail, loginUrl, minutes } = params;
  const html = wrapper(
    'Your Relay TC sign-in link',
    `<p><a href="${loginUrl}" style="color: #b45309;">Sign in to Relay TC</a></p>
     <p style="font-size: 13px; color: #555;">This link works for the next ${minutes} minutes and can be opened more than once. After that, ask for a new one on the sign-in page.
     If you didn't ask for it, you can ignore this email.</p>`
  );
  return deliverEmail({ source: 'sendAgentLoginLinkEmail', from: INVOICE_FROM_EMAIL, to: toEmail, subject: 'Your Relay TC sign-in link', html });
}

// Notifies whoever didn't send the most recent message in a transaction
// thread -- TC or agent, whichever side the recipient is on. Non-fatal if
// it fails, same as every other notification email in this codebase: the
// message itself is already saved by the time this is attempted.
export async function sendNewMessageEmail(params: {
  toEmail: string;
  senderLabel: string;
  propertyAddress: string | null;
  preview: string;
  portalUrl: string;
}) {
  const { toEmail, senderLabel, propertyAddress, preview, portalUrl } = params;
  const dealLabel = propertyAddress || 'your deal';
  const trimmedPreview = preview.length > 200 ? `${preview.slice(0, 200)}…` : preview;
  const html = wrapper(
    `New message about ${dealLabel}`,
    `<p><strong>${escapeHtml(senderLabel)}</strong> sent a message on Relay TC:</p>
     <p style="padding: 12px 16px; background: #f5f0e6; border-radius: 6px; white-space: pre-wrap;">${escapeHtml(trimmedPreview)}</p>
     <p><a href="${portalUrl}" style="color: #b45309;">Reply on Relay TC</a></p>`
  );

  return deliverEmail({ source: 'sendNewMessageEmail',
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${senderLabel} sent a message about ${dealLabel}`,
    html,
  });
}

// Sent when a TC invites the listing agent to the portal from a listing (no deal needed yet).
export async function sendAgentListingInviteEmail(params: {
  toEmail: string;
  tcLabel: string;
  propertyAddress: string | null;
  loginUrl: string;
  /** Whose test outbox it lands in when RELAY_OUTBOX_ONLY=1: the person sending the invitation. */
  ownerUserId?: string;
}) {
  const { toEmail, tcLabel, propertyAddress, loginUrl, ownerUserId } = params;
  const listingLabel = propertyAddress ? `your listing at ${propertyAddress}` : 'your listing';
  const html = wrapper(
    'Follow your listing on Relay TC',
    `<p><strong>${escapeHtml(tcLabel)}</strong> is coordinating ${escapeHtml(listingLabel)} on Relay TC, a transaction
     coordination workspace, and has given you a login to follow it.</p>
     <p><a href="${loginUrl}" style="color: #b45309;">Set up your Relay TC account</a></p>
     <p style="font-size: 13px; color: #555;">This link doesn't expire. It takes you to a page that emails you a fresh sign-in link when you ask for one.</p>
     <p>You'll see the listing's offers, showings and key dates, and you can message ${escapeHtml(tcLabel)} right from the page.</p>`
  );

  return deliverEmail({ source: 'sendAgentListingInviteEmail', ownerUserId,
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${tcLabel} gave you access to your listing on Relay TC`,
    html,
  });
}

// A general (not deal- or listing-specific) message between a coordinator and an agent.
export async function sendDirectMessageEmail(params: { toEmail: string; senderLabel: string; preview: string; portalUrl: string }) {
  const { toEmail, senderLabel, preview, portalUrl } = params;
  const trimmedPreview = preview.length > 200 ? `${preview.slice(0, 200)}…` : preview;
  const html = wrapper(
    `New message from ${senderLabel}`,
    `<p><strong>${escapeHtml(senderLabel)}</strong> sent you a message on Relay TC:</p>
     <p style="padding: 12px 16px; background: #f5f0e6; border-radius: 6px; white-space: pre-wrap;">${escapeHtml(trimmedPreview)}</p>
     <p><a href="${portalUrl}" style="color: #b45309;">Reply on Relay TC</a></p>`
  );

  return deliverEmail({ source: 'sendDirectMessageEmail',
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${senderLabel} sent you a message on Relay TC`,
    html,
  });
}

// Sent when a coordinator asks an agent to connect their Google Calendar so a deal's dates can land in it.
export async function sendAgentCalendarInviteEmail(params: { toEmail: string; tcLabel: string; propertyAddress: string | null; settingsUrl: string }) {
  const { toEmail, tcLabel, propertyAddress, settingsUrl } = params;
  const where = propertyAddress ? ` for ${propertyAddress}` : '';
  const html = wrapper(
    'Connect your calendar to Relay TC',
    `<p><strong>${escapeHtml(tcLabel)}</strong> would like to add the key dates${escapeHtml(where)} straight to your Google Calendar,
     so inspection, financing and closing deadlines show up where you already look.</p>
     <p><a href="${settingsUrl}" style="color: #b45309;">Connect your calendar</a></p>
     <p style="font-size: 13px; color: #555;">You do it once: sign in, open Settings, and choose Connect Google Calendar. Every date on your deals is added right away,
     and later changes follow automatically. You can disconnect at any time.</p>`
  );
  return deliverEmail({ source: 'sendAgentCalendarInviteEmail', from: INVOICE_FROM_EMAIL, to: toEmail, subject: `Add your deal dates to your calendar${propertyAddress ? ` (${propertyAddress})` : ''}`, html });
}

// One email when an agent is given access to several existing deals/listings at once (instead of one email per item).
export async function sendAgentAccessSummaryEmail(params: {
  toEmail: string;
  tcLabel: string;
  deals: number;
  listings: number;
  loginUrl: string;
  /** Whose test outbox it lands in when RELAY_OUTBOX_ONLY=1: the person sending the invitation. */
  ownerUserId?: string;
}) {
  const { toEmail, tcLabel, deals, listings, loginUrl, ownerUserId } = params;
  const parts = [
    deals > 0 ? `${deals} deal${deals === 1 ? '' : 's'}` : '',
    listings > 0 ? `${listings} listing${listings === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const what = parts.join(' and ');
  const html = wrapper(
    "You've been added to your deals",
    `<p><strong>${escapeHtml(tcLabel)}</strong> gave you access to ${escapeHtml(what)} on Relay TC, a transaction coordination workspace.</p>
     <p><a href="${loginUrl}" style="color: #b45309;">Set up your Relay TC account</a></p>
     <p style="font-size: 13px; color: #555;">This link doesn't expire. It takes you to a page that emails you a fresh sign-in link when you ask for one.</p>
     <p>Once in, you'll see each one's checklist, documents and dates, and you can message ${escapeHtml(tcLabel)} right from the page.</p>`
  );
  return deliverEmail({ source: 'sendAgentAccessSummaryEmail', ownerUserId,
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${tcLabel} gave you access to ${what} on Relay TC`,
    html,
  });
}

// Sent when an agent shares a live progress page with their buyer or
// seller from the agent portal. The link is a progress-scope magic link
// (see lib/externalAccess.ts) -- no account needed on the client's end.
// Replies go to the agent, not to Relay TC.
export async function sendClientProgressEmail(params: {
  toEmail: string;
  clientName: string | null;
  agentLabel: string;
  agentEmail: string | null;
  propertyAddress: string | null;
  note: string | null;
  linkUrl: string;
}) {
  const { toEmail, clientName, agentLabel, agentEmail, propertyAddress, note, linkUrl } = params;
  const where = propertyAddress ? ` at ${propertyAddress}` : '';
  const html = wrapper(
    clientName ? `Hi ${clientName}, here's your transaction progress` : "Here's your transaction progress",
    `<p><strong>${escapeHtml(agentLabel)}</strong> shared a live progress page for your transaction${escapeHtml(where)}.
     It shows where things stand, what has been completed, and the key dates coming up.</p>
     ${note ? `<p style="padding: 12px 16px; background: #f5f0e6; border-radius: 6px; white-space: pre-wrap;">${escapeHtml(note)}</p>` : ''}
     <p><a href="${linkUrl}" style="color: #b45309;">View your progress</a></p>
     <p style="font-size: 13px; color: #555;">No account or password needed. Bookmark this page to check back any time; it updates automatically.
     Questions? Just reply to this email and it will go to ${escapeHtml(agentLabel)}.</p>`
  );
  return deliverEmail({ source: 'sendClientProgressEmail',
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${agentLabel} shared your transaction progress${where}`,
    html,
    ...(agentEmail ? { replyTo: agentEmail } : {}),
  });
}

// A new message on a client's board or in a private thread. Goes to the
// client with a link back to their progress page, where the message
// section lives. Reply-To is the sender when we know their address.
export async function sendClientMessageEmail(params: {
  toEmail: string;
  clientName: string | null;
  senderLabel: string;
  senderEmail: string | null;
  propertyAddress: string | null;
  preview: string;
  linkUrl: string;
  isPrivate: boolean;
}) {
  const { toEmail, clientName, senderLabel, senderEmail, propertyAddress, preview, linkUrl, isPrivate } = params;
  const where = propertyAddress ? ` about ${propertyAddress}` : '';
  const trimmed = preview.length > 200 ? `${preview.slice(0, 200)}…` : preview;
  const html = wrapper(
    clientName ? `Hi ${clientName}, you have a new message` : 'You have a new message',
    `<p><strong>${escapeHtml(senderLabel)}</strong> ${isPrivate ? 'sent you a private message' : 'posted on your transaction board'}${escapeHtml(where)}:</p>
     <p style="padding: 12px 16px; background: #f5f0e6; border-radius: 6px; white-space: pre-wrap;">${escapeHtml(trimmed)}</p>
     <p><a href="${linkUrl}" style="color: #b45309;">Open your progress page to reply</a></p>
     <p style="font-size: 13px; color: #555;">No account or password needed.</p>`
  );
  return deliverEmail({ source: 'sendClientMessageEmail',
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${senderLabel} sent you a message${where}`,
    html,
    ...(senderEmail ? { replyTo: senderEmail } : {}),
  });
}

// Sent to everyone else on a deal when one person closes it.
export async function sendDealClosedEmail(params: { toEmail: string; closedBy: string; propertyAddress: string | null; portalUrl: string }) {
  const { toEmail, closedBy, propertyAddress, portalUrl } = params;
  const dealLabel = propertyAddress || 'your deal';
  const html = wrapper(
    `${dealLabel} is closed`,
    `<p><strong>${escapeHtml(closedBy)}</strong> marked <strong>${escapeHtml(dealLabel)}</strong> as closed on Relay TC.</p>
     <p>Every step on the checklist is now complete. Open the deal if anything looks wrong.</p>
     <p><a href="${portalUrl}" style="color: #b45309;">Open the deal</a></p>`
  );
  return deliverEmail({ source: 'sendDealClosedEmail', from: INVOICE_FROM_EMAIL, to: toEmail, subject: `${dealLabel} is closed`, html });
}
