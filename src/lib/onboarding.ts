import { supabaseServer } from './supabase';

/**
 * Whether this account still needs to be routed through /onboarding
 * instead of straight to /dashboard.
 *
 * True only when ALL of:
 *  - onboarding was never explicitly finished (onboarding_completed
 *    metadata, set by the "Go to Dashboard" button on the wizard's last
 *    step), AND
 *  - the account isn't an admin, AND
 *  - the account owns zero agents (the very first real action onboarding
 *    points everyone at -- see its last step's "Add Your Agents")
 *
 * This catches the case where someone confirms their email, gets sent
 * straight to Stripe Checkout for a paid plan, abandons or closes that
 * tab, and then just signs back in directly with their now-confirmed
 * credentials -- they'd otherwise land on an empty dashboard on whatever
 * plan they defaulted to, having never actually set anything up.
 *
 * Deliberately not time-boxed the way TRIAL_ENFORCEMENT_START is in
 * trial.ts -- any account, old or new, with zero agents has by
 * definition never done anything real in Relay, so sending it through
 * onboarding is safe rather than disruptive. An account with even one
 * agent (or the flag already set) is left alone forever.
 */
export async function needsOnboarding(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
  isAdmin = false
): Promise<boolean> {
  if (metadata?.onboarding_completed === true) return false;
  if (isAdmin) return false;

  const { data: agents, error } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('tc_user_id', userId)
    .limit(1);
  if (error) throw error;

  return !agents || agents.length === 0;
}
