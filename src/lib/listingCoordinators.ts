import { supabaseServer } from '@/lib/supabase';
import { hasAgentRole } from '@/lib/privileged';
import { getMutedTypes } from '@/lib/notifications';
import { sendTcListingInviteEmail } from '@/lib/agentPortalEmails';

// An agent with a workspace invites a coordinator onto one of their own listings. The listing never changes owner: the coordinator
// is given access (table listing_coordinators, see add-listing-coordinators.sql) the same way a coordinator is on a deal.

const normalize = (v: string | null | undefined) => (v || '').trim().toLowerCase();

type Person = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };

export type ListingInviteOutcome = 'sent' | 'email_failed' | 'already' | 'agent_account' | 'no_email' | 'self' | 'failed';

async function accountFor(email: string) {
  for (let page = 1; page <= 5; page++) {
    const { data } = await supabaseServer.auth.admin.listUsers({ page, perPage: 1000 });
    const list = data?.users || [];
    const hit = list.find((u) => normalize(u.email) === email);
    if (hit) return hit;
    if (list.length < 1000) return null;
  }
  return null;
}

export async function inviteCoordinatorToListing(params: {
  listing: { id: string; property_address?: unknown };
  user: Person;
  appUrl: string;
  email: string;
  usesRelay?: boolean;
  resend?: boolean;
}): Promise<ListingInviteOutcome | 'not_pending'> {
  try {
    const { listing, user, appUrl } = params;
    const email = normalize(params.email);
    if (!email.includes('@')) return 'no_email';
    if (email === normalize(user.email)) return 'self';
    const address = (listing.property_address as string | null) || null;
    const agentLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'An agent';

    const { data: existing } = await supabaseServer.from('listing_coordinators').select('id, status, invited_by').eq('listing_id', listing.id).ilike('email', email).maybeSingle();
    if (params.resend) {
      if (!existing || existing.status !== 'pending' || existing.invited_by !== user.id) return 'not_pending';
    } else if (existing) {
      return 'already';
    }

    const holder = await accountFor(email);
    if (holder && hasAgentRole(holder)) return 'agent_account';

    if (!existing) {
      const { error } = await supabaseServer.from('listing_coordinators').insert({ listing_id: listing.id, email, invited_by: user.id, status: 'pending' });
      if (error) throw error;
      if (holder && !(await getMutedTypes(holder.id)).includes('invite')) {
        await supabaseServer.from('notifications').insert({
          recipient_user_id: holder.id,
          actor_user_id: user.id,
          event_type: 'invite',
          title: `${agentLabel} invited you to coordinate their listing${address ? ` at ${address}` : ''}`.slice(0, 200),
          link: '/dashboard/listings',
        });
      }
    }
    try {
      await sendTcListingInviteEmail({ toEmail: email, agentLabel, propertyAddress: address, appUrl, usesRelay: params.usesRelay, ownerUserId: user.id });
    } catch (e) {
      console.error('The listing coordinator invitation email was not sent (saved, can be resent):', e);
      return 'email_failed';
    }
    return 'sent';
  } catch (error) {
    console.error('inviteCoordinatorToListing failed (ignored):', error);
    return 'failed';
  }
}

/** The coordinator who accepted on this listing, if any (the table may not exist yet: then there is none). */
export async function acceptedCoordinator(listingId: string): Promise<{ userId: string; email: string; label: string } | null> {
  const { data, error } = await supabaseServer.from('listing_coordinators').select('coordinator_user_id, email').eq('listing_id', listingId).eq('status', 'accepted').limit(1).maybeSingle();
  if (error || !data?.coordinator_user_id) return null;
  const { data: u } = await supabaseServer.auth.admin.getUserById(data.coordinator_user_id as string);
  return { userId: data.coordinator_user_id as string, email: data.email as string, label: (u.user?.user_metadata?.full_name as string | undefined) || (data.email as string) };
}

/** Is this user an accepted coordinator on this listing? */
export async function isListingCoordinator(listingId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseServer.from('listing_coordinators').select('id').eq('listing_id', listingId).eq('coordinator_user_id', userId).eq('status', 'accepted').maybeSingle();
  return !error && Boolean(data);
}

export async function coordinatedListingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseServer.from('listing_coordinators').select('listing_id').eq('coordinator_user_id', userId).eq('status', 'accepted');
  return error ? [] : (data || []).map((r) => r.listing_id as string);
}

/** Waiting listing invitations addressed to this coordinator. */
export async function pendingListingInvites(user: { email?: string | null }) {
  const email = normalize(user.email);
  if (!email) return [];
  const { data, error } = await supabaseServer.from('listing_coordinators').select('id, listing_id, invited_by, created_at').ilike('email', email).eq('status', 'pending').order('created_at', { ascending: false });
  if (error) return [];
  const out: Array<{ inviteId: string; listingId: string; propertyAddress: string | null; agentLabel: string; createdAt: string; kind: 'listing' }> = [];
  for (const row of data || []) {
    const { data: l } = await supabaseServer.from('listings').select('id, property_address').eq('id', row.listing_id).maybeSingle();
    if (!l) continue;
    const { data: inviter } = await supabaseServer.auth.admin.getUserById(row.invited_by as string);
    out.push({
      inviteId: row.id as string,
      listingId: l.id as string,
      propertyAddress: (l.property_address as string | null) ?? null,
      agentLabel: (inviter.user?.user_metadata?.full_name as string | undefined) || inviter.user?.email || 'An agent',
      createdAt: row.created_at as string,
      kind: 'listing',
    });
  }
  return out;
}
