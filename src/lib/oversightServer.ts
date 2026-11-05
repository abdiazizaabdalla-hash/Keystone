import { NextResponse } from 'next/server';
import { AuthError } from './auth';
import { supabaseServer } from './supabase';
import { outboxOnly } from './dealEmail';
import { escapeHtml } from './escapeHtml';
import { findUserIdByEmail } from './team';
import { createAgentLoginLink } from './agentInvite';
import { hasAgentRole, type WithAppMetadata } from './appMetadata';

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

const AGENT_WORKSPACE_PATH = '/dashboard/collaborate#brokerage';
/** Where a free agent login starts: our sign-in page for invited agents, which sends them a fresh link and, the first time, has them set a password. */
const agentSetupPath = (email: string) => `/agent/login?invited=1&email=${encodeURIComponent(email)}`;

/**
 * Who an invitation is going to and where the email should send them. An agent who already has a workspace of their own signs in as usual.
 * Anyone else becomes (or already is) a free agent login: an email with no account gets one made here (tagged as an agent, nothing sent
 * by Supabase), so a brokerage can bring in an agent who has never used Relay without opening public agent sign-up. An email that belongs
 * to a coordinator or other non-agent login is refused, because that account must not be turned into an agent.
 */
export async function prepareInvitee(email: string): Promise<{ agentUserId: string | null; path: string }> {
  const existingId = await findUserIdByEmail(email).catch(() => null);
  if (existingId) {
    const { data } = await supabaseServer.auth.admin.getUserById(existingId);
    const user = data.user as (WithAppMetadata & { id: string }) | null;
    if (!user) return { agentUserId: null, path: agentSetupPath(email) };
    if (!hasAgentRole(user)) throw new AuthError('That email already has a Relay account that is not an agent account. Invite the email the agent uses for their own work, or ask them to use a different one.', 409);
    return { agentUserId: existingId, path: user.app_metadata?.agent_workspace === true ? AGENT_WORKSPACE_PATH : agentSetupPath(email) };
  }
  const link = await createAgentLoginLink(email, process.env.NEXT_PUBLIC_APP_URL || 'https://relaytc.com');
  if (!link.ok) throw new AuthError('Could not set up an account for that email. Check the address and try again.', 400);
  return { agentUserId: link.userId, path: agentSetupPath(email) };
}

/** Where the email should send an already-invited address (for resending). No account is created. */
export async function invitePathFor(email: string): Promise<string> {
  const id = await findUserIdByEmail(email).catch(() => null);
  if (!id) return agentSetupPath(email);
  const { data } = await supabaseServer.auth.admin.getUserById(id);
  return data.user?.app_metadata?.agent_workspace === true ? AGENT_WORKSPACE_PATH : agentSetupPath(email);
}

/** Tell an agent they were invited. Never throws. */
export async function sendBrokerageInvite(params: { ownerUserId: string; ownerLabel: string; toEmail: string; path?: string }): Promise<'outbox' | 'sent' | 'failed'> {
  const result = await sendBrokerageEmail({
    outboxOwnerId: params.ownerUserId,
    fromLabel: params.ownerLabel,
    to: { email: params.toEmail },
    source: 'brokerage_invite',
    subject: `${params.ownerLabel} invited you to join their brokerage on Relay TC`,
    paragraphs: [
      `${params.ownerLabel} invited you to join their brokerage on Relay TC.`,
      'If you accept, you get a free Relay workspace for your own deals, plus their team board, private messages and shared templates and contacts. They see a read-only copy of your deals, deadlines and production numbers and cannot change your deals. Your own templates, contacts and client messages stay private. You can leave at any time.',
    ],
    path: params.path ?? AGENT_WORKSPACE_PATH,
    linkLabel: params.path && params.path !== AGENT_WORKSPACE_PATH ? 'Set up your login and review the invitation' : 'Review and accept',
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
