import { addMemberToTeam, getPendingInviteForEmail, getTeamForUser, getTeamOwnerPlan, markInviteAccepted } from './team';
import { setUserPlan } from './stripeCustomers';

// Joins an account to the Team workspace that invited its email, if there is
// a pending invite. Seats are pre-paid by the owner, so an invited teammate
// gets the team's plan right away.
//
// Only runs for an account whose email address is CONFIRMED. Otherwise
// anyone who knew (or guessed) an invited address could sign up with it,
// never prove they own the inbox, and still take the invite and a seat. The
// invite is picked up at signup when confirmation is off, or at the first
// confirmed sign-in when it's on (see api/auth/signin).
export async function applyPendingTeamInvite(user: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}): Promise<void> {
  if (!user.email || !user.email_confirmed_at) return;
  if (await getTeamForUser(user.id)) return;

  const invite = await getPendingInviteForEmail(user.email);
  if (!invite) return;

  await addMemberToTeam(invite.team_id, user.id, 'member');
  await markInviteAccepted(invite.id);
  // Same plan id as the team's owner -- 'team' or 'brokerage'.
  await setUserPlan(user.id, await getTeamOwnerPlan(invite.team_id));
}

// Only allow redirect targets on our own origin (an email link that sends
// the user to someone else's site after sign-up/reset would be a phishing
// helper). Anything else is dropped and Supabase falls back to its default.
export function sameOriginRedirect(redirectTo: unknown, origin: string): string | undefined {
  if (typeof redirectTo !== 'string' || !redirectTo) return undefined;
  try {
    const url = new URL(redirectTo);
    return url.origin === origin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
