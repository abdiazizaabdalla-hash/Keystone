import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanContactInput } from '@/lib/contactsCrm';
import { isAccessibleOrganization, getUserTeamId } from '@/lib/contactGuard';

const MAX_CONTACTS = 5000;

async function requireTc(request: NextRequest) {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) throw new AuthError('Not available', 403);
  return user;
}

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} contacts:`, error);
  return NextResponse.json({ error: `Failed to ${what} contacts` }, { status: 500 });
}

// GET: every contact in this TC's address book, plus the ones teammates have shared with the team.
export async function GET(request: NextRequest) {
  try {
    const user = await requireTc(request);
    const { data, error } = await supabaseServer
      .from('contacts')
      .select('*')
      .eq('tc_user_id', user.id)
      .order('name', { ascending: true })
      .limit(MAX_CONTACTS);
    if (error) throw error;
    const mine = (data || []).map((c) => ({ ...c, is_mine: true }));

    let shared: Record<string, unknown>[] = [];
    const teamId = await getUserTeamId(user.id);
    if (teamId) {
      const { data: theirs, error: teamError } = await supabaseServer
        .from('contacts')
        .select('*')
        .eq('team_id', teamId)
        .neq('tc_user_id', user.id)
        .order('name', { ascending: true })
        .limit(MAX_CONTACTS);
      if (teamError) throw teamError;
      const names = new Map<string, string>();
      for (const ownerId of new Set((theirs || []).map((c) => c.tc_user_id as string))) {
        const { data: owner } = await supabaseServer.auth.admin.getUserById(ownerId);
        const meta = owner.user?.user_metadata?.full_name;
        names.set(ownerId, typeof meta === 'string' && meta.trim() ? meta.trim() : owner.user?.email || 'a teammate');
      }
      shared = (theirs || []).map((c) => ({ ...c, is_mine: false, shared_by_name: names.get(c.tc_user_id as string) || 'a teammate' }));
    }
    return NextResponse.json([...mine, ...shared]);
  } catch (error) {
    return fail(error, 'load');
  }
}

// POST: add one contact.
export async function POST(request: NextRequest) {
  try {
    const user = await requireTc(request);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const cleaned = cleanContactInput(body);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const orgId = cleaned.value.organization_id;
    if (orgId && !(await isAccessibleOrganization(user.id, orgId))) {
      return NextResponse.json({ error: 'Pick an organization from your contacts' }, { status: 400 });
    }

    // Optionally share with the team right away (only when the TC is on one).
    let shareFields: { team_id?: string; shared_at?: string } = {};
    if (body.shared === true) {
      const teamId = await getUserTeamId(user.id);
      if (!teamId) return NextResponse.json({ error: 'You are not on a team' }, { status: 400 });
      shareFields = { team_id: teamId, shared_at: new Date().toISOString() };
    }

    const { count } = await supabaseServer.from('contacts').select('id', { count: 'exact', head: true }).eq('tc_user_id', user.id);
    if ((count ?? 0) >= MAX_CONTACTS) {
      return NextResponse.json({ error: `You have reached the ${MAX_CONTACTS} contact limit` }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from('contacts')
      .insert({ ...cleaned.value, tc_user_id: user.id, source: 'manual', ...shareFields })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: shareFields.team_id ? 'A contact with that email is already in the team list' : 'You already have a contact with that email' }, { status: 409 });
      throw error;
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return fail(error, 'save');
  }
}
