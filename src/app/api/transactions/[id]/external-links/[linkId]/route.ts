import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';

// DELETE /api/transactions/[id]/external-links/[linkId] -- revoke a
// link (sets revoked_at rather than deleting the row, so the TC's list
// still shows it was created and when it was shut off). Owner-only,
// same as creating one -- not widened to the whole Team.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id: transactionId, linkId } = await params;

    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not available on the agent portal' }, { status: 403 });
    }

    const { data: transaction } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', transactionId)
      .single();
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .eq('tc_user_id', user.id)
        .single();
      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to revoke this link' }, { status: 403 });
      }
    }

    const { error } = await supabaseServer
      .from('external_access_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('transaction_id', transactionId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error revoking external link:', error);
    return NextResponse.json({ error: 'Failed to revoke external link' }, { status: 500 });
  }
}
