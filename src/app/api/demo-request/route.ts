import { NextRequest, NextResponse } from 'next/server';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { checkRateLimit } from '@/lib/rateLimit';

// Where demo requests land. Defaults to the owner's own inbox -- there's
// no team alias set up yet (support@relaytc.com isn't a working inbox as
// of 2026-10), so this goes straight to Abdi until that changes. Override
// with DEMO_REQUEST_TO_EMAIL once a real shared inbox exists.
const DEMO_REQUEST_TO_EMAIL = process.env.DEMO_REQUEST_TO_EMAIL || 'abdiaziz.a.abdalla@gmail.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Public, unauthenticated endpoint -- anyone landing on the marketing
// site can submit this, so every field is trimmed/length-capped and
// HTML-escaped before it goes anywhere near an email body.
export async function POST(request: NextRequest) {
  try {
    // Public endpoint that sends an email: cap it per IP so it can't be
    // used to spam the inbox or burn the Resend quota.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
    if (!(await checkRateLimit(`demo-request:ip:${ip}`, 5, 60 * 60))) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
    const brokerage = typeof body.brokerage === 'string' ? body.brokerage.trim().slice(0, 200) : '';
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const html = `
      <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px; margin: 0 auto;">
        <h2 style="margin: 0 0 16px;">New demo request</h2>
        <p style="margin: 0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p style="margin: 0 0 8px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
        ${brokerage ? `<p style="margin: 0 0 8px;"><strong>Brokerage / Company:</strong> ${escapeHtml(brokerage)}</p>` : ''}
        ${message ? `<p style="margin: 16px 0 0; white-space: pre-wrap;"><strong>What they're looking for:</strong><br/>${escapeHtml(message)}</p>` : ''}
        <p style="margin-top: 24px; color: #6b6b6b; font-size: 13px;">Sent from the Relay TC demo request form. Reply to this email to respond directly to ${escapeHtml(name)}.</p>
      </div>
    `;

    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: INVOICE_FROM_EMAIL,
      to: DEMO_REQUEST_TO_EMAIL,
      replyTo: email,
      subject: `Demo request from ${name}`,
      html,
    });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending demo request email:', error);
    return NextResponse.json({ error: 'Failed to send your request. Please try again.' }, { status: 500 });
  }
}
