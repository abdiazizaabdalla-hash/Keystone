import { supabaseServer } from './supabase';

// Every write to a Supabase Auth user's `user_metadata` has to replace the
// object wholesale (that's how `updateUserById` works -- there's no
// partial-field update for it), so any caller that wants to change just
// one or two fields has to read the rest first and spread it back in.
//
// The bug this exists to prevent: reading that "rest of the metadata"
// from a snapshot taken earlier in the request (e.g. the user object
// `getUserFromRequest` already validated) instead of a fresh read right
// before the write. Several places write to `user_metadata` independently
// and asynchronously -- most importantly the Stripe webhook, which grants
// a paid plan the instant it processes `checkout.session.completed`,
// completely decoupled from whatever request the browser happens to be
// making at that moment (e.g. midway through the onboarding wizard, which
// PATCHes /api/auth/me several times in a row for unrelated fields). If
// one of those PATCHes builds its update from a metadata snapshot taken
// *before* the webhook wrote `plan: 'pro'`, and writes *after* the webhook
// did, it silently overwrites the plan the customer just paid for back to
// whatever it was before -- with no error, and no second webhook event to
// come along and fix it. (This is exactly what happened: paid for Pro,
// finished onboarding, landed back on Starter.)
//
// Reading fresh via the admin API immediately before the write -- instead
// of reusing an already-in-hand `user_metadata` object -- shrinks that
// race window from "the entire lifetime of an unrelated HTTP request" (up
// to several seconds, easily longer than a webhook round-trip) down to a
// single pair of back-to-back calls, which is as tight as this can get
// without adding real optimistic-concurrency control on top of Supabase
// Auth's metadata blob. Every call site that patches user_metadata should
// go through this instead of spreading a metadata object it already has.
export async function mergeUserMetadata(
  userId: string,
  changes: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data: existing, error: getError } = await supabaseServer.auth.admin.getUserById(userId);
  if (getError) throw getError;
  if (!existing.user) throw new Error(`No auth user found for id ${userId}`);

  const { data: updated, error: updateError } = await supabaseServer.auth.admin.updateUserById(userId, {
    user_metadata: { ...existing.user.user_metadata, ...changes },
  });
  if (updateError) throw updateError;

  return updated.user.user_metadata || {};
}
