import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';
import { SUPPORT_EMAIL } from '@/lib/site';

/**
 * Tells the operator inbox (SUPPORT_EMAIL, relaytransactions@gmail.com by
 * default) that someone just created an account. Best effort: a failed
 * email must never block or fail a signup, so errors are only logged.
 */
export async function notifyNewSignup(params: {
  email: string;
  fullName?: string;
  emailConfirmed: boolean;
}): Promise<void> {
  try {
    const { email, fullName, emailConfirmed } = params;
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
    await getResendClient().emails.send({
      from: INVOICE_FROM_EMAIL,
      to: SUPPORT_EMAIL,
      subject: `New Relay TC signup: ${email}`,
      html: `<div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px;">
        <h2 style="margin: 0 0 12px;">New signup</h2>
        <p style="margin: 0 0 4px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin: 0 0 4px;"><strong>Name:</strong> ${escapeHtml(fullName || '(not given)')}</p>
        <p style="margin: 0 0 4px;"><strong>When:</strong> ${escapeHtml(when)} (ET)</p>
        <p style="margin: 0;"><strong>Email confirmed:</strong> ${emailConfirmed ? 'yes (signed in right away)' : 'no (waiting on their confirmation link)'}</p>
      </div>`,
    });
  } catch (error) {
    console.error('Failed to send new-signup notification (non-fatal):', error);
  }
}
