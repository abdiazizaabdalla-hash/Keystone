import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { escapeHtml } from '@/lib/escapeHtml';
import { logAudit } from '@/lib/audit';
import { formatDisplayDate } from '@/lib/dueDates';
import { loadInvoiceBundle, loadTcInfo } from '@/lib/invoiceData';
import { getInvoicePayUrlForDocument } from '@/lib/stripeConnect';
import { INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { deliverEmail, EmailDeliveryError } from '@/lib/agentPortalEmails';
import { supabaseServer } from '@/lib/supabase';

// POST: emails the agent a "pay this invoice online" link, for agents who have no Relay account (they only need the email).
// Requires the coordinator's Stripe to be connected. The invoice itself can still be sent as a PDF from the other button.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const note = typeof body?.message === 'string' ? body.message.trim().slice(0, 1500) : '';

    const { invoice, agent, transaction } = await loadInvoiceBundle(id, user.id, isAdmin);
    if (!agent || !transaction) return NextResponse.json({ error: 'Invoice is missing agent or property data' }, { status: 500 });
    if (invoice.paid) return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 400 });
    if (!agent.email) return NextResponse.json({ error: 'This agent has no email address on file. Add one on the Agents page first.' }, { status: 400 });

    const origin = new URL(request.url).origin;
    const payUrl = await getInvoicePayUrlForDocument({ invoice, tcUserId: agent.tc_user_id, origin });
    if (!payUrl) {
      return NextResponse.json(
        { error: 'Online payment is not available for this invoice. Connect Stripe first (or a payment may already be on its way).', code: 'stripe_not_connected' },
        { status: 400 }
      );
    }

    const tc = await loadTcInfo(agent.tc_user_id);
    const money = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const first = (agent.name || '').split(' ')[0] || agent.name || 'there';
    const html = `
      <div style="font-family: Georgia, serif; color: #1a1a1a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${escapeHtml(first)},</p>
        <p>${note ? escapeHtml(note).replace(/\n/g, '<br/>') : `Your invoice for ${escapeHtml(transaction.property_address)} is ready. You can pay it online in under a minute.`}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 6px 0; color: #666;">Invoice</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(invoice.invoice_number)}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Property</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(transaction.property_address)}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Due</td><td style="padding: 6px 0; text-align: right;">${formatDisplayDate(invoice.due_date)}</td></tr>
          <tr><td style="padding: 10px 0; font-weight: bold; border-top: 1px solid #ddd;">Total due</td><td style="padding: 10px 0; text-align: right; font-weight: bold; border-top: 1px solid #ddd;">${money(invoice.amount_owed)}</td></tr>
        </table>
        <p style="margin: 24px 0;"><a href="${payUrl}" style="background: #2563eb; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: bold;">Pay ${money(invoice.amount_owed)} online</a></p>
        <p style="color: #666; font-size: 13px;">Pay by card or bank transfer. You do not need an account.</p>
        <p>Thanks,<br/>${escapeHtml(tc.name)}</p>
      </div>
    `;

    await deliverEmail({
      from: INVOICE_FROM_EMAIL,
      to: agent.email,
      replyTo: tc.email ?? undefined,
      subject: `Pay invoice ${invoice.invoice_number} — ${transaction.property_address}`,
      html,
      source: 'invoice-pay-link',
      ownerUserId: agent.tc_user_id,
    });

    const sentAt = new Date().toISOString();
    await supabaseServer.from('invoices').update({ sent_at: sentAt, sent_to: agent.email }).eq('id', invoice.id);
    await logAudit(request, user, 'invoice.email_pay_link', { entityType: 'invoice', entityId: invoice.id, metadata: { to: agent.email } });
    return NextResponse.json({ sent: true, to: agent.email, sentAt });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt }, { status: error.status });
    if (error instanceof EmailDeliveryError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Error emailing a pay link:', error);
    return NextResponse.json({ error: 'Failed to email the pay link' }, { status: 500 });
  }
}
