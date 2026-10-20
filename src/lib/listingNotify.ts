import { after } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getResendClient, INVOICE_FROM_EMAIL } from '@/lib/resendClient';
import { escapeHtml } from '@/lib/escapeHtml';
import { EMAIL_RE } from '@/lib/stepEmailTemplates';
import { checkRateLimit } from '@/lib/rateLimit';

// Short "something new is waiting" emails about a listing. They never carry offer terms, prices, buyer
// names or message text: only the address, what kind of thing happened, and a link that needs a login.
// Everything here is best effort and runs after the response, so a mail problem never breaks the action.

function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1f;max-width:520px;margin:0 auto;font-size:15px;line-height:1.55;">
    <h2 style="margin:0 0 14px;font-size:18px;">${escapeHtml(title)}</h2>${bodyHtml}
    <p style="margin:22px 0 0;font-size:12px;color:#7a7a85;">Sent by Relay TC.</p></div>`;
}

async function send(to: string, subject: string, title: string, bodyHtml: string): Promise<void> {
  if (!EMAIL_RE.test(to)) return;
  const { error } = await getResendClient().emails.send({ from: INVOICE_FROM_EMAIL, to, subject: subject.slice(0, 200), html: shell(title, bodyHtml) });
  if (error) console.error('Listing notice email rejected (ignored):', error);
}

function later(job: () => Promise<void>): void {
  const safe = async () => {
    try {
      await job();
    } catch (error) {
      console.error('Listing notice failed (ignored):', error);
    }
  };
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/** Tell the listing agent a new offer or showing was logged (only when the TC switched this on and shared the listing). */
export function queueAgentNotice(params: { listingId: string; what: 'offer' | 'showing' | 'message'; appUrl: string }): void {
  later(async () => {
    const { data: listing } = await supabaseServer
      .from('listings')
      .select('id, property_address, agent_id, share_with_agent, notify_agent, status')
      .eq('id', params.listingId)
      .maybeSingle();
    if (!listing || listing.share_with_agent !== true || !listing.agent_id) return;
    if (params.what !== 'message' && listing.notify_agent !== true) return; // offers and showings only when the TC switched it on
    const { data: agent } = await supabaseServer.from('agents').select('email').eq('id', listing.agent_id).maybeSingle();
    const to = (agent?.email as string | null)?.trim().toLowerCase();
    if (!to) return;
    // However many offers, showings or messages get logged, one listing emails its agent at most 6 times an hour.
    if (!(await checkRateLimit(`listing-notice:${params.listingId}`, 6, 60 * 60))) return;
    const noun = params.what;
    const link = `${params.appUrl}/agent/listings/${listing.id}`;
    await send(
      to,
      params.what === 'message' ? `New message about ${listing.property_address}` : `New ${noun} logged: ${listing.property_address}`,
      params.what === 'message' ? 'New message about your listing' : `New ${noun} on your listing`,
      `<p>${params.what === 'message' ? 'Your coordinator wrote to you about' : `A new ${noun} was logged for`} <strong>${escapeHtml(listing.property_address)}</strong>.</p>
       <p><a href="${escapeHtml(link)}" style="color:#2563eb;font-weight:600;">Open it in your Relay TC agent portal</a></p>
       <p style="font-size:13px;color:#555;">You need to sign in to see the details.</p>`
    );
  });
}

/** Tell the TC an agent wrote on a listing. No message text goes in the email. */
export function queueTcCommentNotice(params: { listingId: string; appUrl: string; fromLabel: string }): void {
  later(async () => {
    const { data: listing } = await supabaseServer.from('listings').select('id, property_address, tc_user_id').eq('id', params.listingId).maybeSingle();
    if (!listing) return;
    const { data } = await supabaseServer.auth.admin.getUserById(listing.tc_user_id as string);
    const to = data.user?.email;
    if (!to) return;
    const link = `${params.appUrl}/dashboard/listings/${listing.id}`;
    await send(
      to,
      `New message on ${listing.property_address}`,
      'New message on a listing',
      `<p><strong>${escapeHtml(params.fromLabel)}</strong> wrote on <strong>${escapeHtml(listing.property_address)}</strong>.</p>
       <p><a href="${escapeHtml(link)}" style="color:#2563eb;font-weight:600;">Open the listing</a></p>`
    );
  });
}

/** Tell the TC offers arrived by email for a listing. Sender and count only. */
export function queueTcInboundNotice(params: { listingId: string; appUrl: string; fromLabel: string; fileCount: number }): void {
  later(async () => {
    const { data: listing } = await supabaseServer.from('listings').select('id, property_address, tc_user_id').eq('id', params.listingId).maybeSingle();
    if (!listing) return;
    const { data } = await supabaseServer.auth.admin.getUserById(listing.tc_user_id as string);
    const to = data.user?.email;
    if (!to) return;
    const link = `${params.appUrl}/dashboard/listings/${listing.id}`;
    const files = params.fileCount === 1 ? '1 file' : `${params.fileCount} files`;
    await send(
      to,
      `Offer received by email: ${listing.property_address}`,
      'An offer arrived by email',
      `<p>An email from <strong>${escapeHtml(params.fromLabel)}</strong> with ${files} was forwarded to <strong>${escapeHtml(listing.property_address)}</strong>.</p>
       <p><a href="${escapeHtml(link)}" style="color:#2563eb;font-weight:600;">Review it in Relay</a> and add it as an offer when you are ready.</p>`
    );
  });
}
