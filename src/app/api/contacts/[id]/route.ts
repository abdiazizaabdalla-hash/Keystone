import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanContactInput } from '@/lib/contactsCrm';
import { isOwnedOrganization } from '@/lib/contactGuard';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} contact:`, error);
  return NextResponse.json({ error: `Failed to ${what} contact` }, { status: 500 });
}

async function requireTc(request: NextRequest) {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) throw new AuthError('Not available', 403);
  await assertTrialActive(user);
  return user;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireTc(request);
    const body = await request.json().catch(() => ({}));
    const cleaned = cleanContactInput(body);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const orgId = cleaned.value.organization_id;
    if (orgId && (orgId === id || !(await isOwnedOrganization(user.id, orgId)))) {
      return NextResponse.json({ error: 'Pick an organization from your contacts' }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from('contacts')
      .update({ ...cleaned.value, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tc_user_id', user.id)
      .select('*')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'You already have a contact with that email' }, { status: 409 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return fail(error, 'update');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireTc(request);
    const { error } = await supabaseServer.from('contacts').delete().eq('id', id).eq('tc_user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'delete');
  }
}
