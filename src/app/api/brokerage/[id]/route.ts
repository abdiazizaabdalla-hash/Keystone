import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertWorkspaceAgent, activeLinkForAgent, agentLabels, pendingInvitesFor } from '@/lib/oversight';
import { isDuplicateLink, notifyOwnerRoster, oversightError } from '@/lib/oversightServer';
import { getUserPlan } from '@/lib/appMetadata';
import { isTeamPlan } from '@/lib/plans';

// PATCH { action: 'accept' | 'decline' | 'leave' }: the agent answers an invitation, or leaves the brokerage they joined.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = body.action;
    if (action !== 'accept' && action !== 'decline' && action !== 'leave') throw new AuthError('Choose accept, decline or leave.', 400);
    const now = new Date().toISOString();
    const name = (await agentLabels([user.id])).get(user.id)?.name ?? user.email ?? 'An agent';

    if (action === 'leave') {
      const current = await activeLinkForAgent(user.id);
      if (!current || current.id !== id) throw new AuthError('Not found', 404);
      const { error } = await supabaseServer.from('brokerage_links').update({ status: 'left', ended_at: now }).eq('id', id);
      if (error) throw error;
      await logAudit(request, user, 'brokerage.leave', { entityType: 'brokerage_link', entityId: id });
      await notifyOwnerRoster(current.owner_user_id, user.id, `${name} left your brokerage`);
      return NextResponse.json({ success: true });
    }

    const invite = (await pendingInvitesFor(user.id, user.email)).find((i) => i.id === id);
    if (!invite) throw new AuthError('Not found', 404);

    if (action === 'decline') {
      const { error } = await supabaseServer.from('brokerage_links').update({ status: 'declined', responded_at: now, ended_at: now, agent_user_id: user.id }).eq('id', id);
      if (error) throw error;
      await logAudit(request, user, 'brokerage.decline', { entityType: 'brokerage_link', entityId: id });
      return NextResponse.json({ success: true });
    }

    if (await activeLinkForAgent(user.id)) throw new AuthError('You are already in a brokerage. Leave it first to join another.', 409);
    const { data: owner } = await supabaseServer.auth.admin.getUserById(invite.owner_user_id);
    if (!owner.user || !isTeamPlan(getUserPlan(owner.user))) throw new AuthError('This invitation is no longer available.', 409);
    const { error } = await supabaseServer.from('brokerage_links').update({ status: 'active', agent_user_id: user.id, responded_at: now }).eq('id', id).eq('status', 'pending');
    if (isDuplicateLink(error)) throw new AuthError('You are already in a brokerage. Leave it first to join another.', 409);
    if (error) throw error;
    await logAudit(request, user, 'brokerage.accept', { entityType: 'brokerage_link', entityId: id });
    await notifyOwnerRoster(invite.owner_user_id, user.id, `${name} joined your brokerage`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return oversightError(error, 'update your brokerage');
  }
}
