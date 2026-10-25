import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';

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

/** Loads one contact only if it belongs to this TC. */
export async function loadOwnedContact(userId: string, id: string) {
  const { data } = await supabaseServer.from('contacts').select('*').eq('id', id).eq('tc_user_id', userId).maybeSingle();
  return data;
}

/** True when the id is an organization contact owned by this TC. */
export async function isOwnedOrganization(userId: string, id: string): Promise<boolean> {
  const { data } = await supabaseServer.from('contacts').select('id, contact_type').eq('id', id).eq('tc_user_id', userId).maybeSingle();
  return !!data && data.contact_type === 'organization';
}
