import { NextResponse } from 'next/server';
import { AuthError } from './auth';
import { supabaseServer } from './supabase';
import { outboxOnly } from './dealEmail';
import { escapeHtml } from './escapeHtml';

export function oversightError(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const info = error as { code?: string } | null;
  if (info && (info.code === 'PGRST205' || info.code === '42P01')) {
    console.error(`Error trying to ${what} (database not updated):`, error);
    return NextResponse.json({ error: 'The database needs one more update before brokerage oversight works. Run add-brokerage-oversight.sql in Supabase.' }, { status: 500 });
  }
  console.error(`Error trying to ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const isDuplicateLink = (error: { code?: string } | null | undefined) => error?.code === '23505';

/**
 * One email between a brokerage and its agents (invite, deal closed, commission confirmed or paid, weekly digest). Locally this lands in
 * the email outbox table; in production it goes through Resend. `to` is an email address or a user id. Never throws.
 */
export async function sendBrokerageEmail(params: { outboxOwnerId: string; fromLabel: string; to: { email: string } | { userId: string }; source: string; subject: string; paragraphs: string[]; path: string; linkLabel: string }): Promise<'outbox' | 'sent' | 'failed' | 'skipped'> {
  try {
    let toEmail = 'email' in params.to ? params.to.email : null;
    if (!toEmail && 'userId' in params.to) {
      const { data } = await supabaseServer.auth.admin.getUserById(params.to.userId);
      toEmail = data.user?.email ?? null;
    }
    if (!toEmail) return 'skipped';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://relaytc.com';
    const url = `${appUrl}${params.path}`;
    const text = `${params.paragraphs.join('\n\n')}\n\n${params.linkLabel}: ${url}`;
    if (outboxOnly()) {
      const { error } = await supabaseServer.from('email_outbox').insert({ owner_user_id: params.outboxOwnerId, source: params.source, to_emails: [toEmail], from_name: params.fromLabel, subject: params.subject, body: text });
      if (error) throw error;
      return 'outbox';
    }
    const { getResendClient, INVOICE_FROM_EMAIL } = await import('./resendClient');
    const html = `<div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px; margin: 0 auto;"><h2 style="margin: 0 0 16px;">${escapeHtml(params.subject)}</h2>${params.paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('')}<p><a href="${url}" style="color: #b45309;">${escapeHtml(params.linkLabel)}</a></p><p style="margin-top: 24px;">Thanks,<br/>Relay TC</p></div>`;
    const { error } = await getResendClient().emails.send({ from: INVOICE_FROM_EMAIL, to: toEmail, subject: params.subject, html });
    if (error) throw new Error(String(error.message ?? error));
    return 'sent';
  } catch (error) {
    console.error(`Brokerage email (${params.source}) failed:`, error);
    return 'failed';
  }
}

/** Tell an agent they were invited. Never throws. */
export async function sendBrokerageInvite(params: { ownerUserId: string; ownerLabel: string; toEmail: string }): Promise<'outbox' | 'sent' | 'failed'> {
  const result = await sendBrokerageEmail({
    outboxOwnerId: params.ownerUserId,
    fromLabel: params.ownerLabel,
    to: { email: params.toEmail },
    source: 'brokerage_invite',
    subject: `${params.ownerLabel} invited you to join their brokerage on Relay TC`,
    paragraphs: [
      `${params.ownerLabel} invited you to join their brokerage on Relay TC.`,
      'If you accept, you get a free Relay workspace for your own deals, plus their team board, private messages and shared templates and contacts. They see a read-only copy of your deals, deadlines and production numbers. They cannot change your deals. Your own templates, contacts and client messages stay private. You can leave at any time.',
    ],
    path: '/dashboard/collaborate#brokerage',
    linkLabel: 'Review and accept',
  });
  return result === 'skipped' ? 'failed' : result;
}

/** A line in the owner's notification bell about the roster itself (an agent joined or left). Never throws. */
export async function notifyOwnerRoster(ownerUserId: string, actorUserId: string, title: string): Promise<void> {
  try {
    await supabaseServer.from('notifications').insert({ recipient_user_id: ownerUserId, actor_user_id: actorUserId, event_type: 'brokerage', title: title.slice(0, 200), link: '/dashboard/collaborate#agents' });
  } catch (error) {
    console.error('Brokerage roster notification failed:', error);
  }
}
