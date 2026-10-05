import { supabaseServer } from './supabase';

// Anything that decides what an account is ALLOWED to do (its plan, whether
// it's a platform admin, whether it's an agent-portal login) lives in
// Supabase Auth's `app_metadata`, never `user_metadata`.
//
// Why: `user_metadata` is writable by the signed-in user themselves -- the
// browser holds the public anon key and a session, and
// `supabase.auth.updateUser({ data: { ... } })` (or a plain PUT to the
// auth API) will happily write any keys. If the plan or `is_admin` flag
// were read from there, anyone with a free account could grant themselves
// Team features or full admin visibility. `app_metadata` can only be
// written with the service-role key, i.e. from our own server code.
//
// Harmless per-user preferences (name, fee defaults, due-date workflow
// settings, onboarding flag) stay in `user_metadata`.
export interface WithAppMetadata {
  app_metadata?: Record<string, unknown> | null;
}

export function getUserPlan(user: WithAppMetadata | null | undefined): string | undefined {
  const plan = user?.app_metadata?.plan;
  return typeof plan === 'string' ? plan : undefined;
}

export function isPlatformAdmin(user: WithAppMetadata | null | undefined): boolean {
  return user?.app_metadata?.is_admin === true;
}

export function hasAgentRole(user: WithAppMetadata | null | undefined): boolean {
  return user?.app_metadata?.role === 'agent';
}

// Same read-fresh-then-merge pattern as mergeUserMetadata (see
// lib/userMetadata.ts), for the server-only app_metadata blob.
export async function mergeAppMetadata(
  userId: string,
  changes: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data: existing, error: getError } = await supabaseServer.auth.admin.getUserById(userId);
  if (getError) throw getError;
  if (!existing.user) throw new Error(`No auth user found for id ${userId}`);

  const { data: updated, error: updateError } = await supabaseServer.auth.admin.updateUserById(userId, {
    app_metadata: { ...existing.user.app_metadata, ...changes },
  });
  if (updateError) throw updateError;

  return updated.user.app_metadata || {};
}
