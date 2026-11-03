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

/** Tell an agent they were invited. Locally this lands in the email outbox table; in production it goes through Resend. Never throws. */
export async function sendBrokerageInvite(params: { ownerUserId: string; ownerLabel: string; toEmail: string }): Promise<'outbox' | 'sent' | 'failed'> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://relaytc.com';
  const subject = `${params.ownerLabel} invited you to join their brokerage on Relay TC`;
  const text = `${params.ownerLabel} invited you to join their brokerage on Relay TC.\n\nIf you accept, they can see your deals, deadlines and production numbers, and can edit your deals. Your templates, contacts and client messages stay private. You can leave at any time.\n\nReview and accept: ${appUrl}/dashboard/brokerage`;
  try {
    if (outboxOnly()) {
      const { error } = await supabaseServer.from('email_outbox').insert({ owner_user_id: params.ownerUserId, source: 'brokerage_invite', to_emails: [params.toEmail], from_name: params.ownerLabel, subject, body: text });
      if (error) throw error;
      return 'outbox';
    }
    const { getResendClient, INVOICE_FROM_EMAIL } = await import('./resendClient');
    const html = `<div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 520px; margin: 0 auto;"><h2 style="margin: 0 0 16px;">Join a brokerage on Relay TC</h2><p><strong>${escapeHtml(params.ownerLabel)}</strong> invited you to join their brokerage.</p><p>If you accept, they can see your deals, deadlines and production numbers, and can edit your deals. Your templates, contacts and client messages stay private. You can leave at any time.</p><p><a href="${appUrl}/dashboard/brokerage" style="color: #b45309;">Review and accept</a></p><p style="margin-top: 24px;">Thanks,<br/>Relay TC</p></div>`;
    const { error } = await getResendClient().emails.send({ from: INVOICE_FROM_EMAIL, to: params.toEmail, subject, html });
    if (error) throw new Error(String(error.message ?? error));
    return 'sent';
  } catch (error) {
    console.error('Brokerage invite email failed:', error);
    return 'failed';
  }
}

/** A line in the owner's notification bell about the roster itself (an agent joined or left). Never throws. */
export async function notifyOwnerRoster(ownerUserId: string, actorUserId: string, title: string): Promise<void> {
  try {
    await supabaseServer.from('notifications').insert({ recipient_user_id: ownerUserId, actor_user_id: actorUserId, event_type: 'brokerage', title: title.slice(0, 200), link: '/dashboard/collaborate#agents' });
  } catch (error) {
    console.error('Brokerage roster notification failed:', error);
  }
}
