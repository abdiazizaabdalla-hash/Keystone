import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanContactInput } from '@/lib/contactsCrm';
import { isOwnedOrganization } from '@/lib/contactGuard';

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

// GET: every contact in this TC's address book.
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
    return NextResponse.json(data || []);
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
    if (orgId && !(await isOwnedOrganization(user.id, orgId))) {
      return NextResponse.json({ error: 'Pick an organization from your contacts' }, { status: 400 });
    }

    const { count } = await supabaseServer.from('contacts').select('id', { count: 'exact', head: true }).eq('tc_user_id', user.id);
    if ((count ?? 0) >= MAX_CONTACTS) {
      return NextResponse.json({ error: `You have reached the ${MAX_CONTACTS} contact limit` }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from('contacts')
      .insert({ ...cleaned.value, tc_user_id: user.id, source: 'manual' })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'You already have a contact with that email' }, { status: 409 });
      throw error;
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return fail(error, 'save');
  }
}
