import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';

// PATCH /api/transactions/[id]/client-steps -- body { visibleTaskIds: string[] }.
// Sets which checklist steps the client sees on their progress link.
// Steps are per deal, so editing them updates every progress link on it at
// once. Owner-only, same as creating a link.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const { id: transactionId } = await params;

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
        return NextResponse.json({ error: 'You do not have permission to edit this' }, { status: 403 });
      }
    }

    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.visibleTaskIds)) {
      return NextResponse.json({ error: 'visibleTaskIds must be an array' }, { status: 400 });
    }
    const ids = (body.visibleTaskIds as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 200);

    const { error: clearError } = await supabaseServer
      .from('tasks')
      .update({ client_visible: false })
      .eq('transaction_id', transactionId);
    if (clearError) throw clearError;
    if (ids.length > 0) {
      const { error } = await supabaseServer
        .from('tasks')
        .update({ client_visible: true })
        .eq('transaction_id', transactionId)
        .in('id', ids);
      if (error) throw error;
    }
    return NextResponse.json({ success: true, visibleTaskIds: ids });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    }
    console.error('Error updating client steps:', error);
    return NextResponse.json({ error: 'Failed to update steps' }, { status: 500 });
  }
}
