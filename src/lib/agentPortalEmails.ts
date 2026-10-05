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
  actionLink: string;
}) {
  const { toEmail, tcLabel, propertyAddress, actionLink } = params;
  const dealLabel = propertyAddress ? `for ${propertyAddress}` : 'on Relay TC';
  const html = wrapper(
    "You've been added to a deal",
    `<p><strong>${escapeHtml(tcLabel)}</strong> added you ${escapeHtml(dealLabel)} on Relay TC, a transaction coordination
     workspace.</p>
     <p><a href="${actionLink}" style="color: #b45309;">Log in to Relay TC</a></p>
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
