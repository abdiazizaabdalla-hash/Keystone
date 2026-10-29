import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';

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
}) {
  const { toEmail, tcLabel, propertyAddress, loginUrl, fromListing } = params;
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

  const resend = getResendClient();
  return resend.emails.send({
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: fromListing ? `Your listing${propertyAddress ? ` at ${propertyAddress}` : ''} is now an active transaction` : `${tcLabel} added you to a deal on Relay TC`,
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
  const resend = getResendClient();
  return resend.emails.send({ from: INVOICE_FROM_EMAIL, to: toEmail, subject: 'Your Relay TC sign-in link', html });
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

  const resend = getResendClient();
  return resend.emails.send({
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
}) {
  const { toEmail, tcLabel, propertyAddress, loginUrl } = params;
  const listingLabel = propertyAddress ? `your listing at ${propertyAddress}` : 'your listing';
  const html = wrapper(
    'Follow your listing on Relay TC',
    `<p><strong>${escapeHtml(tcLabel)}</strong> is coordinating ${escapeHtml(listingLabel)} on Relay TC, a transaction
     coordination workspace, and has given you a login to follow it.</p>
     <p><a href="${loginUrl}" style="color: #b45309;">Set up your Relay TC account</a></p>
     <p style="font-size: 13px; color: #555;">This link doesn't expire. It takes you to a page that emails you a fresh sign-in link when you ask for one.</p>
     <p>You'll see the listing's offers, showings and key dates, and you can message ${escapeHtml(tcLabel)} right from the page.</p>`
  );

  const resend = getResendClient();
  return resend.emails.send({
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

  const resend = getResendClient();
  return resend.emails.send({
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
  const resend = getResendClient();
  return resend.emails.send({ from: INVOICE_FROM_EMAIL, to: toEmail, subject: `Add your deal dates to your calendar${propertyAddress ? ` (${propertyAddress})` : ''}`, html });
}

// One email when an agent is given access to several existing deals/listings at once (instead of one email per item).
export async function sendAgentAccessSummaryEmail(params: {
  toEmail: string;
  tcLabel: string;
  deals: number;
  listings: number;
  loginUrl: string;
}) {
  const { toEmail, tcLabel, deals, listings, loginUrl } = params;
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
  const resend = getResendClient();
  return resend.emails.send({
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
  const resend = getResendClient();
  return resend.emails.send({
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${agentLabel} shared your transaction progress${where}`,
    html,
    ...(agentEmail ? { replyTo: agentEmail } : {}),
  });
}
