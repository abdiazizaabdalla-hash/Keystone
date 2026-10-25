import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanContactInput } from '@/lib/contactsCrm';
import { isAccessibleOrganization, loadAccessibleContact, getUserTeamId } from '@/lib/contactGuard';

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

// Edit a contact you own, or one a teammate shared with your team. The newsletter flag and
// the sharing switch stay with the owner.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireTc(request);
    const body = await request.json().catch(() => ({}));
    const cleaned = cleanContactInput(body);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const existing = await loadAccessibleContact(user.id, id);
    if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const isOwner = existing.tc_user_id === user.id;

    const orgId = cleaned.value.organization_id;
    if (orgId && (orgId === id || !(await isAccessibleOrganization(user.id, orgId)))) {
      return NextResponse.json({ error: 'Pick an organization from your contacts' }, { status: 400 });
    }

    const update: Record<string, unknown> = { ...cleaned.value, updated_at: new Date().toISOString() };
    if (!isOwner) delete update.newsletter;
    if (isOwner && typeof body.shared === 'boolean') {
      if (body.shared) {
        const teamId = await getUserTeamId(user.id);
        if (!teamId) return NextResponse.json({ error: 'You are not on a team' }, { status: 400 });
        update.team_id = teamId;
        update.shared_at = existing.team_id === teamId ? existing.shared_at : new Date().toISOString();
      } else {
        update.team_id = null;
        update.shared_at = null;
      }
    }

    const { data, error } = await supabaseServer.from('contacts').update(update).eq('id', id).select('*').maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: existing.team_id || update.team_id ? 'A contact with that email is already in the team list' : 'You already have a contact with that email' }, { status: 409 });
      }
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return fail(error, 'update');
  }
}

// Delete a contact you own. On a contact a teammate shared, "delete" only takes it off the
// team list: it stays on the account of whoever shared it.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireTc(request);
    const existing = await loadAccessibleContact(user.id, id);
    if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (existing.tc_user_id === user.id) {
      const { error } = await supabaseServer.from('contacts').delete().eq('id', id).eq('tc_user_id', user.id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    const { error } = await supabaseServer.from('contacts').update({ team_id: null, shared_at: null }).eq('id', id).eq('tc_user_id', existing.tc_user_id);
    if (error) throw error;
    return NextResponse.json({ success: true, removedFromTeamOnly: true });
  } catch (error) {
    return fail(error, 'delete');
  }
}
