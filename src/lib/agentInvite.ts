import { supabaseServer } from '@/lib/supabase';
import { hasAgentRole, mergeAppMetadata } from '@/lib/privileged';
import { sendAgentInviteEmail, sendAgentListingInviteEmail } from '@/lib/agentPortalEmails';
import { logListingActivity } from '@/lib/listings';
import { queueCalendarSync } from '@/lib/calendarSync';

// Shared by the deal invite (POST /api/agent-invites) and the listing invite
// (POST /api/listings/[id]/invite-agent): makes a one-time sign-in link for an agent's email,
// creating the account on first use and tagging a brand-new account as an agent. Nothing is sent
// here; the caller emails the link.
//
// `otherAccount` is true when the email already belongs to a non-agent login (a coordinator, say).
// That login must not be turned into an agent just because someone typed its email, so no link is
// returned for it.

export type AgentLinkResult =
  | { ok: true; actionLink: string; alreadyHadAccount: boolean; userId: string | null; isAgent: boolean }
  | { ok: false; reason: 'other_account' | 'link_failed' };

export async function createAgentLoginLink(email: string, appUrl: string, opts: { allowOtherAccount?: boolean } = {}): Promise<AgentLinkResult> {
  const { data: linkData, error: linkError } = await supabaseServer.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${appUrl}/agent/accept` },
  });

  const user = linkData?.user;
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) {
    console.error('Error generating agent invite link:', linkError);
    return { ok: false, reason: 'link_failed' };
  }

  const isNew = Boolean(user && !user.last_sign_in_at && !hasAgentRole(user) && Date.now() - new Date(user.created_at).getTime() < 2 * 60 * 1000);
  if (user && isNew) {
    try {
      await mergeAppMetadata(user.id, { role: 'agent' });
    } catch (err) {
      console.error('Error tagging invited agent account:', err);
    }
  }
  if (user && !isNew && !hasAgentRole(user) && !opts.allowOtherAccount) return { ok: false, reason: 'other_account' };

  return { ok: true, actionLink, alreadyHadAccount: Boolean(user && !isNew), userId: user?.id ?? null, isAgent: Boolean(user && (isNew || hasAgentRole(user))) };
}

export type ListingInviteOutcome = 'sent' | 'already' | 'no_agent' | 'no_email' | 'not_shared' | 'other_account' | 'failed';

/**
 * Emails the listing's agent a login for the agent portal, where the listing shows up under Listings.
 * Needs: an agent on the listing, with an email, and "Share with the agent" on. Never throws.
 */
export async function sendListingPortalInvite(params: {
  listing: { id: string; agent_id?: unknown; share_with_agent?: unknown; property_address?: unknown };
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null };
  appUrl: string;
  /** Skip when this agent was already invited to this listing (used for automatic invites; the Send button always sends). */
  onlyIfNew?: boolean;
}): Promise<ListingInviteOutcome> {
  try {
    const { listing, user, appUrl } = params;
    if (!listing.agent_id) return 'no_agent';
    if (listing.share_with_agent !== true) return 'not_shared';
    const { data: agent } = await supabaseServer.from('agents').select('name, email').eq('id', listing.agent_id as string).maybeSingle();
    if (!agent) return 'no_agent';
    const email = String(agent.email || '').trim().toLowerCase();
    if (!email.includes('@')) return 'no_email';

    if (params.onlyIfNew) {
      const { data: prior } = await supabaseServer.from('listing_activity').select('id').eq('listing_id', listing.id).like('summary', `Invited % (${email}) to the agent portal`).limit(1);
      if (prior && prior.length > 0) return 'already';
    }

    const link = await createAgentLoginLink(email, appUrl);
    if (!link.ok) return link.reason === 'other_account' ? 'other_account' : 'failed';

    const tcLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'Your transaction coordinator';
    await sendAgentListingInviteEmail({
      toEmail: email,
      tcLabel,
      propertyAddress: (listing.property_address as string | null) || null,
      loginUrl: agentSetupUrl(appUrl, email),
    });
    await logListingActivity(listing.id, user, `Invited ${agent.name || email} (${email}) to the agent portal`);
    return 'sent';
  } catch (error) {
    console.error('sendListingPortalInvite failed (ignored):', error);
    return 'failed';
  }
}


/**
 * Where an invited agent starts. A fixed page on our site, so the link in the email never expires: the page sends
 * a fresh sign-in link on demand (see /agent/login). The one-time links that do expire are never put in an email.
 */
export function agentSetupUrl(appUrl: string, email: string): string {
  return `${appUrl}/agent/login?invited=1&email=${encodeURIComponent(email)}`;
}

export type TxInviteOutcome = 'sent' | 'already' | 'no_agent' | 'no_email' | 'failed';

/** Invites the transaction's agent (or `email`) to the portal for this deal. Skips quietly when they are already invited. Never throws. */
export async function inviteAgentToTransaction(params: {
  transaction: { id: string; agent_id?: unknown; property_address?: unknown };
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
  appUrl: string;
  email?: string;
  /** The deal came from the agent's own listing: the email says so. */
  fromListing?: boolean;
}): Promise<TxInviteOutcome> {
  try {
    const { transaction, user, appUrl } = params;
    let email = normalize(params.email);
    if (!email) {
      if (!transaction.agent_id) return 'no_agent';
      const { data: agent } = await supabaseServer.from('agents').select('email').eq('id', transaction.agent_id as string).maybeSingle();
      if (!agent) return 'no_agent';
      email = normalize(agent.email as string | null);
    }
    if (!email.includes('@')) return 'no_email';

    const { data: existing } = await supabaseServer.from('agent_invites').select('status').eq('transaction_id', transaction.id).eq('email', email).maybeSingle();
    if (existing) return 'already';

    const { error: insertError } = await supabaseServer.from('agent_invites').insert({ transaction_id: transaction.id, email, invited_by: user.id, status: 'pending' });
    if (insertError) throw insertError;

    // Makes sure the agent has a login (and tags a brand-new one as an agent). The email carries a fixed page link, not this one-time link.
    const link = await createAgentLoginLink(email, appUrl, { allowOtherAccount: true });
    if (!link.ok) return 'failed';

    // The deal goes straight onto the agent's portal: no accepting. (Skipped for an email that belongs to a coordinator's
    // login; that one keeps the old invite-and-accept step, which is what protects a coordinator from being tagged as an agent.)
    if (link.isAgent && link.userId) {
      const { error: grantError } = await supabaseServer
        .from('transaction_agents')
        .upsert({ transaction_id: transaction.id, agent_user_id: link.userId, invited_by: user.id }, { onConflict: 'transaction_id,agent_user_id', ignoreDuplicates: true });
      if (grantError) {
        console.error('Could not give the agent access to the deal (they can still accept the invite):', grantError);
      } else {
        await supabaseServer.from('agent_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('transaction_id', transaction.id).eq('email', email);
        queueCalendarSync(transaction.id);
      }
    }

    const tcLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'Your transaction coordinator';
    await sendAgentInviteEmail({ toEmail: email, tcLabel, propertyAddress: (transaction.property_address as string | null) || null, loginUrl: agentSetupUrl(appUrl, email), fromListing: params.fromListing === true });
    return 'sent';
  } catch (error) {
    console.error('inviteAgentToTransaction failed (ignored):', error);
    return 'failed';
  }
}

const normalize = (e: string | null | undefined) => (e || '').trim().toLowerCase();
