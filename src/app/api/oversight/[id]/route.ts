import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertBrokerageOwner } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { SplitError, isSplitType } from '@/lib/commissionMath';

// DELETE: cancel an invitation, or remove an agent from the brokerage. The agent keeps all of their deals.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const { data: link, error } = await supabaseServer.from('brokerage_links').select('id, status, agent_user_id').eq('id', id).eq('owner_user_id', user.id).in('status', ['pending', 'active']).maybeSingle();
    if (error) throw error;
    if (!link) throw new AuthError('Not found', 404);
    const { error: updateError } = await supabaseServer.from('brokerage_links').update({ status: 'removed', ended_at: new Date().toISOString() }).eq('id', id);
    if (updateError) throw updateError;
    await logAudit(request, user, link.status === 'active' ? 'brokerage.remove_agent' : 'brokerage.cancel_invite', { entityType: 'brokerage_link', entityId: id, metadata: { agentUserId: link.agent_user_id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return oversightError(error, 'remove that agent');
  }
}

// PATCH { splitType, splitValue }: the default commission split for one active agent (used when proposing a split on their deals).
// { splitType: null } clears it.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { data: link, error } = await supabaseServer.from('brokerage_links').select('id').eq('id', id).eq('owner_user_id', user.id).eq('status', 'active').maybeSingle();
    if (error) throw error;
    if (!link) throw new AuthError('Not found', 404);

    let update: { default_split_type: string | null; default_split_value: number | null };
    if (body.splitType === null) {
      update = { default_split_type: null, default_split_value: null };
    } else {
      const value = typeof body.splitValue === 'number' ? body.splitValue : Number(body.splitValue);
      if (!isSplitType(body.splitType)) throw new SplitError('Choose how the commission is split.');
      if (!Number.isFinite(value) || value < 0 || (body.splitType === 'percent' && value > 100) || value > 100_000_000) throw new SplitError(body.splitType === 'percent' ? 'A percentage must be between 0 and 100.' : 'Enter an amount of zero or more.');
      update = { default_split_type: body.splitType, default_split_value: Math.round(value * 100) / 100 };
    }
    const { error: updateError } = await supabaseServer.from('brokerage_links').update(update).eq('id', id);
    if (updateError) throw updateError;
    await logAudit(request, user, 'brokerage.default_split', { entityType: 'brokerage_link', entityId: id, metadata: update });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SplitError) return NextResponse.json({ error: error.message }, { status: 400 });
    return oversightError(error, 'save that split');
  }
}
