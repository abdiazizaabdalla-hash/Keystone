import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { getTeamIdForUser } from '@/lib/team';

// Shared guard for the Contacts CRM routes: only a TC (never an agent), and writes need
// an active trial/plan. Every query is then scoped by tc_user_id so nobody can see or
// touch another TC's contacts.
export async function requireContactsUser(request: NextRequest, opts: { write?: boolean } = {}) {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) throw new AuthError('Not available', 403);
  if (opts.write) await assertTrialActive(user);
  return user;
}

export function contactsFail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

/** The team this TC belongs to, or null. A lookup failure counts as "no team" so nothing extra is ever shared. */
export async function getUserTeamId(userId: string): Promise<string | null> {
  try {
    return await getTeamIdForUser(userId);
  } catch {
    return null;
  }
}

/** Is this contact visible to the TC: their own, or one a teammate shared with the TC's current team. */
export function canAccessContact(c: { tc_user_id: string; team_id?: string | null }, userId: string, teamId: string | null): boolean {
  return c.tc_user_id === userId || (!!teamId && !!c.team_id && c.team_id === teamId);
}

/** Loads one contact only if the TC owns it or a teammate shared it with their team. */
export async function loadAccessibleContact(userId: string, id: string) {
  const { data } = await supabaseServer.from('contacts').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const teamId = data.team_id ? await getUserTeamId(userId) : null;
  return canAccessContact(data, userId, teamId) ? data : null;
}

/** True when the id is an organization contact this TC can see (their own or team-shared). */
export async function isAccessibleOrganization(userId: string, id: string): Promise<boolean> {
  const org = await loadAccessibleContact(userId, id);
  return !!org && org.contact_type === 'organization';
}
