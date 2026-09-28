import { supabaseServer } from './supabase';
import { stripe } from './stripe';
import { getStripeCustomerByUserId } from './stripeCustomers';

// Team billing is now real per-seat quantity billing (see lib/stripe.ts —
// STRIPE_PRICE_TEAM is a $19/mo per-unit price). 3 is the *minimum* a
// Team subscription is ever started at ($57/mo, matching the old flat
// price), not a hard cap: addPaidSeat/removePaidSeat below adjust the
// Stripe subscription's quantity as members are added/removed, and
// getPaidSeatCount reads the live quantity rather than assuming 3.
export const TEAM_SEAT_LIMIT = 3;

export type TeamRole = 'owner' | 'member';

/**
 * Current paid seat quantity on the owner's Team subscription. Falls
 * back to TEAM_SEAT_LIMIT if there's no subscription on file yet (e.g. a
 * team created before real billing existed, or mid self-heal).
 */
export async function getPaidSeatCount(ownerId: string): Promise<number> {
  const customer = await getStripeCustomerByUserId(ownerId);
  if (!customer?.stripe_subscription_id) return TEAM_SEAT_LIMIT;

  const subscription = await stripe.subscriptions.retrieve(customer.stripe_subscription_id);
  return subscription.items.data[0]?.quantity || TEAM_SEAT_LIMIT;
}

/**
 * Adds one paid seat to the owner's Team subscription. Stripe invoices
 * the prorated remainder of the current billing period immediately
 * (proration_behavior: 'always_invoice') rather than waiting for the
 * next renewal — the new seat then bills at $19/mo alongside the rest
 * starting next cycle. Throws if the owner has no active subscription to
 * adjust (shouldn't happen for a real Team owner, but callers should
 * treat it as a real error, not silently proceed).
 */
export async function addPaidSeat(ownerId: string): Promise<void> {
  const customer = await getStripeCustomerByUserId(ownerId);
  if (!customer?.stripe_subscription_id) {
    throw new Error('Team owner has no active subscription to add a paid seat to');
  }

  const subscription = await stripe.subscriptions.retrieve(customer.stripe_subscription_id);
  const item = subscription.items.data[0];
  if (!item) {
    throw new Error('Team subscription has no billable item');
  }

  await stripe.subscriptions.update(customer.stripe_subscription_id, {
    items: [{ id: item.id, quantity: (item.quantity || 0) + 1 }],
    proration_behavior: 'always_invoice',
  });
}

/**
 * Removes one paid seat from the owner's Team subscription, never going
 * below the 3-seat minimum. Uses Stripe's default proration (a credit
 * applied to the next invoice) — removing someone doesn't retroactively
 * refund what was already charged for the current period. No-ops
 * quietly if there's no subscription on file, or already at the floor.
 */
export async function removePaidSeat(ownerId: string): Promise<void> {
  const customer = await getStripeCustomerByUserId(ownerId);
  if (!customer?.stripe_subscription_id) return;

  const subscription = await stripe.subscriptions.retrieve(customer.stripe_subscription_id);
  const item = subscription.items.data[0];
  if (!item) return;

  const currentQuantity = item.quantity || TEAM_SEAT_LIMIT;
  const newQuantity = Math.max(TEAM_SEAT_LIMIT, currentQuantity - 1);
  if (newQuantity === currentQuantity) return;

  await stripe.subscriptions.update(customer.stripe_subscription_id, {
    items: [{ id: item.id, quantity: newQuantity }],
  });
}

export interface TeamRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

export interface TeamMembership {
  team: TeamRow;
  role: TeamRole;
}

/** The team a user belongs to (as owner or member), or null if they're on none. */
export async function getTeamForUser(userId: string): Promise<TeamMembership | null> {
  const { data: membership, error } = await supabaseServer
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!membership) return null;

  const { data: team, error: teamError } = await supabaseServer
    .from('teams')
    .select('*')
    .eq('id', membership.team_id)
    .single();
  if (teamError) throw teamError;

  return { team, role: membership.role as TeamRole };
}

/** Creates a team owned by userId if they don't already own or belong to one. Idempotent. */
export async function ensureTeamForOwner(userId: string): Promise<TeamRow> {
  const existing = await getTeamForUser(userId);
  if (existing) return existing.team;

  const { data: team, error } = await supabaseServer
    .from('teams')
    .insert({ owner_id: userId })
    .select()
    .single();
  if (error) throw error;

  const { error: memberError } = await supabaseServer
    .from('team_members')
    .insert({ team_id: team.id, user_id: userId, role: 'owner' });
  if (memberError) throw memberError;

  return team;
}

export async function getTeamMemberUserIds(teamId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId);
  if (error) throw error;
  return (data || []).map((m) => m.user_id as string);
}

export async function getTeamMemberCount(teamId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from('team_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('team_id', teamId);
  if (error) throw error;
  return count || 0;
}

export async function getPendingInviteCount(teamId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from('team_invites')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('status', 'pending');
  if (error) throw error;
  return count || 0;
}

export async function addMemberToTeam(teamId: string, userId: string, role: TeamRole = 'member') {
  const { error } = await supabaseServer
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId, role });
  if (error) throw error;
}

export async function removeMemberFromTeam(teamId: string, userId: string) {
  const { error } = await supabaseServer
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Pending invite for this email (case-insensitive), if any. */
export async function getPendingInviteForEmail(email: string) {
  const { data, error } = await supabaseServer
    .from('team_invites')
    .select('*')
    .ilike('email', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createInvite(teamId: string, email: string, invitedBy: string) {
  const { data, error } = await supabaseServer
    .from('team_invites')
    .insert({ team_id: teamId, email, invited_by: invitedBy, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markInviteAccepted(inviteId: string) {
  const { error } = await supabaseServer
    .from('team_invites')
    .update({ status: 'accepted' })
    .eq('id', inviteId);
  if (error) throw error;
}

export async function getTeamInvites(teamId: string) {
  const { data, error } = await supabaseServer
    .from('team_invites')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Resolves an email to an existing auth user id, or null if no account exists yet. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabaseServer.rpc('get_user_id_by_email', { lookup_email: email });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * The set of tc_user_ids whose agents/transactions a given user should see.
 * Team owners see their whole team's data; everyone else (including
 * regular team members) sees only their own — team members deliberately do
 * NOT see each other's pipeline, only the roster (see /api/team).
 */
export async function getVisibleTcUserIds(userId: string): Promise<string[]> {
  const membership = await getTeamForUser(userId);
  if (membership && membership.role === 'owner') {
    return getTeamMemberUserIds(membership.team.id);
  }
  return [userId];
}

/**
 * Called when a subscription downgrades/cancels. If this user owned a
 * team, the whole team funded by that subscription unwinds: every other
 * member drops back to Starter (via onMemberDowngraded, injected to avoid
 * a circular import with stripeCustomers.ts) and the team row is deleted
 * (cascades team_members/team_invites). If they were just a regular
 * member, only their own membership is removed — the team keeps going for
 * the owner and everyone else.
 */
export async function dissolveTeamMembership(
  userId: string,
  onMemberDowngraded: (memberUserId: string) => Promise<void>
) {
  const membership = await getTeamForUser(userId);
  if (!membership) return;

  if (membership.role === 'owner') {
    const memberIds = await getTeamMemberUserIds(membership.team.id);
    for (const memberId of memberIds) {
      if (memberId === userId) continue;
      await onMemberDowngraded(memberId);
    }
    const { error } = await supabaseServer.from('teams').delete().eq('id', membership.team.id);
    if (error) throw error;
  } else {
    await removeMemberFromTeam(membership.team.id, userId);
  }
}
