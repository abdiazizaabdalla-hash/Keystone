import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { AGENT_LOGIN_LINK_MINUTES, createAgentLoginToken, findAgentAccount } from '@/lib/agentLoginToken';
import { sendAgentLoginLinkEmail } from '@/lib/agentPortalEmails';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// POST { email }: emails an agent a sign-in link that works for AGENT_LOGIN_LINK_MINUTES minutes and can be opened
// more than once (so a mail scanner opening it first does not break it). Always answers the same way whether or
// not the email has an agent account, so this cannot be used to find out who has one.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(`agent-login-link:ip:${ip}`, 10, 10 * 60),
      checkRateLimit(`agent-login-link:email:${email}`, 4, 10 * 60),
    ]);
    if (!ipOk || !emailOk) {
      return NextResponse.json({ error: 'Too many requests. Please wait a few minutes and try again.' }, { status: 429 });
    }

    const account = await findAgentAccount(email);
    if (account) {
      const origin = request.nextUrl.origin;
      const token = createAgentLoginToken(email);
      await sendAgentLoginLinkEmail({ toEmail: email, loginUrl: `${origin}/agent/accept?t=${encodeURIComponent(token)}`, minutes: AGENT_LOGIN_LINK_MINUTES });
    }
    return NextResponse.json({ status: 'sent' });
  } catch (error) {
    console.error('Error sending agent login link:', error);
    return NextResponse.json({ error: 'Something went wrong sending your login link. Please try again.' }, { status: 500 });
  }
}
