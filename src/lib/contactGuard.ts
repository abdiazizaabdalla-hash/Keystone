import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isCollaboratorOnly } from '@/lib/agentPortal';
import { getTeamIdForUser } from '@/lib/team';
import { activeLinkForAgent, brokerageOn } from '@/lib/oversight';

// Shared guard for the Contacts CRM routes: only a TC (never an agent), and writes need
// an active trial/plan. Every query is then scoped by tc_user_id so nobody can see or
// touch another TC's contacts.
export async function requireContactsUser(request: NextRequest, opts: { write?: boolean } = {}) {
  const { user } = await getUserFromRequest(request);
  if (isCollaboratorOnly(user)) throw new AuthError('Not available', 403);
  if (opts.write) await assertTrialActive(user);
  return user;
}

export function contactsFail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  // A column or table from one of the contacts SQL scripts is missing: say so, instead of a vague failure.
  const e = error as { code?: string; message?: string } | null;
  if (e && typeof e === 'object' && (e.code === '42703' || e.code === '42P01' || /team_id|contact_type|contact_activity|contact_reminders/.test(e.message || ''))) {
    console.error(`Error ${what} (database script missing):`, error);
    return NextResponse.json(
      { error: 'Your database is missing a Contacts update. Run add-contacts-relationships.sql and add-contacts-team-sharing.sql in the Supabase SQL editor, then run: notify pgrst, \'reload schema\'; and reload. (Database said: ' + String(e.message || e.code || 'unknown').slice(0, 200) + ')', code: 'database_update_needed' },
      { status: 503 }
    );
  }
  console.error(`Error ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

/**
 * The list this person shares contacts into: their team (a coordinator on a team, or a brokerage owner), or, for an agent who
 * joined a brokerage, the brokerage owner's team. Same mechanism either way: a shared contact carries the team id, stays on
 * its owner's account and is visible to, and editable by, everyone who shares that list. `kind` only changes the wording.
 * A lookup failure counts as "no team" so nothing extra is ever shared.
 */
export async function getContactsTeam(userId: string): Promise<{ teamId: string; kind: 'team' | 'brokerage' } | null> {
  try {
    const own = await getTeamIdForUser(userId);
    if (own) return { teamId: own, kind: 'team' };
    if (!brokerageOn()) return null;
    const link = await activeLinkForAgent(userId);
    if (!link) return null;
    const brokerageTeam = await getTeamIdForUser(link.owner_user_id);
    return brokerageTeam ? { teamId: brokerageTeam, kind: 'brokerage' } : null;
  } catch {
    return null;
  }
}

/** The team id contacts are shared into for this person, or null. */
export async function getUserTeamId(userId: string): Promise<string | null> {
  return (await getContactsTeam(userId))?.teamId ?? null;
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
