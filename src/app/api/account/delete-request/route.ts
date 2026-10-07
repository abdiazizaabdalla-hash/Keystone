import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { mergeAppMetadata } from '@/lib/privileged';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';
import { SUPPORT_EMAIL } from '@/lib/site';

// POST /api/account/delete-request -- the user asks for their account and
// data to be deleted. Deleting is deliberately a reviewed step (active
// subscriptions, team ownership and other people's shared deals can all be
// affected), so this records the request, emails the operator, and confirms
// to the user, who is told we'll complete it within 30 days.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return NextResponse.json({ error: 'Please confirm the request.' }, { status: 400 });
    }
    if (!(await checkRateLimit(`delete-request:${user.id}`, 3, 24 * 60 * 60))) {
      return NextResponse.json({ error: 'Too many requests. Try again tomorrow.' }, { status: 429 });
    }

    const existing = (user.app_metadata as { deletion_requested_at?: string } | null)?.deletion_requested_at;
    const requestedAt = existing || new Date().toISOString();

    if (!existing) {
      await mergeAppMetadata(user.id, { deletion_requested_at: requestedAt });
      await logAudit(request, user, 'account.deletion_requested', { entityType: 'user', entityId: user.id });

      try {
        const resend = getResendClient();
        await resend.emails.send({
          from: INVOICE_FROM_EMAIL,
          to: SUPPORT_EMAIL,
          subject: `Account deletion request: ${user.email}`,
          html: `<p><strong>${escapeHtml(user.email)}</strong> (user id ${escapeHtml(user.id)}) asked to delete their Relay TC account and data on ${escapeHtml(requestedAt)}.</p>
                 <p>Complete it within 30 days: cancel any subscription in Stripe, handle team ownership, then delete the user's data and auth account.</p>`,
        });
        if (user.email) {
          await resend.emails.send({
            from: INVOICE_FROM_EMAIL,
            to: user.email,
            subject: 'We received your Relay TC deletion request',
            html: `<p>We received your request to delete your Relay TC account and data. We will complete it within 30 days and email you when it is done.</p>
                   <p>If you have an active subscription, cancel it from your Account page so you aren't billed again. If you didn't make this request, reply to this email right away.</p>`,
          });
        }
      } catch (emailError) {
        // The request is recorded either way (metadata + audit log).
        console.error('Failed to send deletion-request emails (non-fatal):', emailError);
      }
    }

    return NextResponse.json({ requested: true, requestedAt });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error recording deletion request:', error);
    return NextResponse.json({ error: 'Failed to submit your request' }, { status: 500 });
  }
}
