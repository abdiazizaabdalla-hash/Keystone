import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertBrokerageOwner } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';

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
