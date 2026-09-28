import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';

const wrapper = (title: string, bodyHtml: string) => `
  <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px; margin: 0 auto;">
    <h2 style="margin: 0 0 16px;">${title}</h2>
    ${bodyHtml}
    <p style="margin-top: 24px;">Thanks,<br/>Relay TC</p>
  </div>
`;

/**
 * Notifies an existing account that they were just added directly to a
 * team (the direct-add path in POST /api/team, as opposed to a pending
 * invite for someone with no account yet).
 */
export async function sendTeamAddedEmail(params: {
  toEmail: string;
  ownerLabel: string;
  appUrl: string;
}) {
  const { toEmail, ownerLabel, appUrl } = params;
  const html = wrapper(
    "You've been added to a team",
    `<p><strong>${ownerLabel}</strong> added you to their team on Relay TC. You now have Team-plan
     access — no separate payment needed, it's covered by their subscription.</p>
     <p><a href="${appUrl}/dashboard/collaborate" style="color: #b45309;">View your team</a></p>`
  );

  const resend = getResendClient();
  return resend.emails.send({
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${ownerLabel} added you to their team on Relay TC`,
    html,
  });
}

/**
 * Invites someone with no Relay TC account yet to sign up and join a
 * team (the pending-invite path). The invite is auto-consumed when they
 * sign up with this same email (see /api/auth/signup).
 */
export async function sendTeamInviteEmail(params: {
  toEmail: string;
  ownerLabel: string;
  appUrl: string;
}) {
  const { toEmail, ownerLabel, appUrl } = params;
  const signupUrl = `${appUrl}/auth?mode=signup&email=${encodeURIComponent(toEmail)}`;
  const html = wrapper(
    "You're invited to a team on Relay TC",
    `<p><strong>${ownerLabel}</strong> invited you to join their team on Relay TC, a transaction
     coordination workspace. Create your account with this email address to activate it — you'll get
     Team-plan access right away, covered by their subscription.</p>
     <p><a href="${signupUrl}" style="color: #b45309;">Create your account</a></p>`
  );

  const resend = getResendClient();
  return resend.emails.send({
    from: INVOICE_FROM_EMAIL,
    to: toEmail,
    subject: `${ownerLabel} invited you to their team on Relay TC`,
    html,
  });
}
