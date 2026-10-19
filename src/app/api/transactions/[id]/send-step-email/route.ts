import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { canAccessTransactionDates } from '@/lib/keyDates';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { checkRateLimit } from '@/lib/rateLimit';
import { escapeHtml } from '@/lib/escapeHtml';
import { logAudit } from '@/lib/audit';
import { EMAIL_RE, LIMITS } from '@/lib/stepEmailTemplates';
import { supabaseServer } from '@/lib/supabase';

// Sends the email a TC wrote (usually from a checklist step's template) to the
// people they picked on a deal. It goes out from Relay's sending address with the
// TC's name, replies go straight to the TC, and the TC is copied so the message
// also lands in their own inbox.

function plainToHtml(text: string, signature: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1f;">${paragraphs}` +
    `<p style="margin:22px 0 0;font-size:12px;color:#7a7a85;">${escapeHtml(signature)}</p></div>`
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);
    if (!(await canAccessTransactionDates(transactionId, user.id, isAdmin))) {
      return NextResponse.json({ error: 'You do not have permission to email from this transaction' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.body === 'string' ? body.body.trim() : '';
    const to: string[] = Array.isArray(body.to)
      ? [...new Set<string>(body.to.filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.trim().toLowerCase()))]
      : [];

    if (to.length === 0 || to.length > LIMITS.recipients) {
      return NextResponse.json({ error: `Choose between 1 and ${LIMITS.recipients} recipients` }, { status: 400 });
    }
    if (to.some((address) => !EMAIL_RE.test(address))) {
      return NextResponse.json({ error: 'One of the email addresses is not valid' }, { status: 400 });
    }
    if (!subject || subject.length > LIMITS.subject) {
      return NextResponse.json({ error: `Subject must be 1-${LIMITS.subject} characters` }, { status: 400 });
    }
    if (!message || message.length > LIMITS.body) {
      return NextResponse.json({ error: `Message must be 1-${LIMITS.body} characters` }, { status: 400 });
    }
    if (/\[[^\]\n]{1,60}\]/.test(subject + '\n' + message)) {
      return NextResponse.json({ error: 'Replace the [bracketed] prompts with real text before sending' }, { status: 400 });
    }

    const allowed = await checkRateLimit(`step-email:${user.id}`, 40, 60 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'You have sent a lot of emails in the last hour. Try again a bit later.' }, { status: 429 });
    }

    const meta = (user.user_metadata || {}) as { full_name?: string };
    const tcName = (meta.full_name || '').trim() || user.email || 'Your transaction coordinator';
    const tcEmail = user.email || null;

    // Blind-copy the deal's own inbound address so the email is filed on the
    // transaction's Communication card automatically (on unless the TC unticks it).
    const logToDeal = body.logToDeal !== false;
    let dealAddress: string | null = null;
    const inboundDomain = process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN;
    if (logToDeal && inboundDomain) {
      const { data: tx } = await supabaseServer.from('transactions').select('inbound_token').eq('id', transactionId).maybeSingle();
      if (tx?.inbound_token) dealAddress = `deal-${tx.inbound_token}@${inboundDomain}`;
    }

    const fromAddress = INVOICE_FROM_EMAIL.match(/<([^>]+)>/)?.[1] ?? INVOICE_FROM_EMAIL;
    const safeName = tcName.replace(/["<>\r\n,;]/g, '').slice(0, 60);
    const from = `${safeName} via Relay TC <${fromAddress}>`;

    const { error } = await getResendClient().emails.send({
      from,
      to,
      ...(tcEmail ? { cc: [tcEmail], replyTo: tcEmail } : {}),
      ...(dealAddress ? { bcc: [dealAddress] } : {}),
      subject,
      html: plainToHtml(message, `Sent by ${tcName} using Relay TC. Reply to this email to reach them directly.`),
      text: `${message}\n\n-- Sent by ${tcName} using Relay TC. Reply to this email to reach them directly.`,
    });
    if (error) {
      console.error('Resend rejected a step email:', error);
      return NextResponse.json({ error: 'The email could not be sent. Please try again.' }, { status: 502 });
    }

    await logAudit(request, { id: user.id, email: user.email }, 'transaction.step_email_sent', {
      entityType: 'transaction',
      entityId: transactionId,
      metadata: { recipients: to.length, loggedToDeal: Boolean(dealAddress), taskId: typeof body.taskId === 'string' ? body.taskId : null },
    });

    return NextResponse.json({ success: true, loggedToDeal: Boolean(dealAddress) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    }
    console.error('Error sending step email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
