import { supabaseServer } from '@/lib/supabase';
import { hasAgentRole, mergeAppMetadata } from '@/lib/privileged';
import { sendAgentListingInviteEmail } from '@/lib/agentPortalEmails';
import { logListingActivity } from '@/lib/listings';

// Shared by the deal invite (POST /api/agent-invites) and the listing invite
// (POST /api/listings/[id]/invite-agent): makes a one-time sign-in link for an agent's email,
// creating the account on first use and tagging a brand-new account as an agent. Nothing is sent
// here; the caller emails the link.
//
// `otherAccount` is true when the email already belongs to a non-agent login (a coordinator, say).
// That login must not be turned into an agent just because someone typed its email, so no link is
// returned for it.

export type AgentLinkResult =
  | { ok: true; actionLink: string; alreadyHadAccount: boolean }
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

  return { ok: true, actionLink, alreadyHadAccount: Boolean(user && !isNew) };
}

export type ListingInviteOutcome = 'sent' | 'no_agent' | 'no_email' | 'not_shared' | 'other_account' | 'failed';

/**
 * Emails the listing's agent a login for the agent portal, where the listing shows up under Listings.
 * Needs: an agent on the listing, with an email, and "Share with the agent" on. Never throws.
 */
export async function sendListingPortalInvite(params: {
  listing: { id: string; agent_id?: unknown; share_with_agent?: unknown; property_address?: unknown };
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null };
  appUrl: string;
}): Promise<ListingInviteOutcome> {
  try {
    const { listing, user, appUrl } = params;
    if (!listing.agent_id) return 'no_agent';
    if (listing.share_with_agent !== true) return 'not_shared';
    const { data: agent } = await supabaseServer.from('agents').select('name, email').eq('id', listing.agent_id as string).maybeSingle();
    if (!agent) return 'no_agent';
    const email = String(agent.email || '').trim().toLowerCase();
    if (!email.includes('@')) return 'no_email';

    const link = await createAgentLoginLink(email, appUrl);
    if (!link.ok) return link.reason === 'other_account' ? 'other_account' : 'failed';

    const tcLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'Your transaction coordinator';
    await sendAgentListingInviteEmail({
      toEmail: email,
      tcLabel,
      propertyAddress: (listing.property_address as string | null) || null,
      actionLink: link.actionLink,
    });
    await logListingActivity(listing.id, user, `Invited ${agent.name || email} to the agent portal`);
    return 'sent';
  } catch (error) {
    console.error('sendListingPortalInvite failed (ignored):', error);
    return 'failed';
  }
}
