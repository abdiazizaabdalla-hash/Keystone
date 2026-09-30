import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';

const wrapper = (title: string, bodyHtml: string) => `
  <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px; margin: 0 auto;">
    <h2 style="margin: 0 0 16px;">${title}</h2>
    ${bodyHtml}
    <p style="margin-top: 24px;">Thanks,<br/>Relay TC</p>
  </div>
`;

// The actual invite/login link itself comes from Supabase's own
// signInWithOtp email (see POST /api/agent-invites) -- that's what an
// agent with no password can actually click to get in. This is a second,
// plain-language heads-up sent right after, from an address that says
// what it's about instead of a generic "magic link" subject line. Purely
// cosmetic -- if it fails to send, the real login email already went out
// and the invite still works.
export async function sendAgentInviteHeadsUpEmail(params: {
  toEmail: string;
  tcLabel: string;
  propertyAddress: string | null;
  appUrl: string;
}) {
  const { toEmail, tcLabel, propertyAddress, appUrl } = params;
  const dealLabel = propertyAddress ? `for ${propertyAddress}` : 'on Relay TC';
  const html = wrapper(
    "You've been added to a deal",
    `<p><strong>${tcLabel}</strong> added you ${dealLabel} on Relay TC, a transaction coordination
     workspace. Check your inbox for a separate "Log in" email from Supabase Auth -- that link signs
     you in directly, no password needed.</p>
     <p>Once in, you'll be able to see the deal's checklist, upload and download documents, and
     message ${tcLabel} right from the page.</p>
     <p><a href="${appUrl}/agent/login" style="color: #b45309;">Already have access? Log in</a></p>`
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
    `<p><strong>${senderLabel}</strong> sent a message on Relay TC:</p>
     <p style="padding: 12px 16px; background: #f5f0e6; border-radius: 6px; white-space: pre-wrap;">${trimmedPreview}</p>
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
