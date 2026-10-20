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
}) {
  const { toEmail, tcLabel, propertyAddress, loginUrl } = params;
  const dealLabel = propertyAddress ? `for ${propertyAddress}` : 'on Relay TC';
  const html = wrapper(
    "You've been added to a deal",
    `<p><strong>${escapeHtml(tcLabel)}</strong> added you ${escapeHtml(dealLabel)} on Relay TC, a transaction coordination
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
    subject: `${tcLabel} added you to a deal on Relay TC`,
    html,
  });
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
