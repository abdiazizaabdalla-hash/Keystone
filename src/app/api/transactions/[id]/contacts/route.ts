import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getVisibleTcUserIds } from '@/lib/team';
import { isAgentUser, assertAgentOnTransaction } from '@/lib/agentPortal';

// The "Deal Contacts" list shown right under the Checklist card on the
// transaction detail page -- buyer, seller, lender, title/escrow, etc.
// The linked Agent is intentionally NOT part of this table; the frontend
// renders that row straight from the existing agents record instead (see
// dashboard/transactions/[id]/page.tsx), so editing it stays in one place
// (the Agents page) rather than forking into a second copy here.

async function assertCanAccessTransaction(
  transactionId: string,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;

  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('agent_id')
    .eq('id', transactionId)
    .single();

  if (!transaction) return false;

  const visibleIds = await getVisibleTcUserIds(userId);
  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', transaction.agent_id)
    .in('tc_user_id', visibleIds)
    .single();

  return Boolean(agent);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);

    // An invited agent reads the same contact list the TC sees (view-only
    // -- see /agent/transactions/[id]), scoped via transaction_agents
    // rather than the TC-ownership check below.
    if (isAgentUser(user)) {
      await assertAgentOnTransaction(transactionId, user.id);
    } else if (!(await assertCanAccessTransaction(transactionId, user.id, isAdmin))) {
      return NextResponse.json({ error: 'You do not have permission to view this transaction' }, { status: 403 });
    }

    const { data, error } = await supabaseServer
      .from('transaction_contacts')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('position', { ascending: true });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching transaction contacts:', error);
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);

    if (!(await assertCanAccessTransaction(transactionId, user.id, isAdmin))) {
      return NextResponse.json({ error: 'You do not have permission to edit this transaction' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const role = typeof body.role === 'string' ? body.role.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

    // A row with nothing in it isn't worth persisting -- the frontend
    // only calls this once a blank box actually has something typed into
    // it, but this guards the API itself against the same thing.
    if (!role && !name && !email && !phone) {
      return NextResponse.json({ error: 'At least one field is required' }, { status: 400 });
    }

    const { count } = await supabaseServer
      .from('transaction_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('transaction_id', transactionId);

    const { data, error } = await supabaseServer
      .from('transaction_contacts')
      .insert({
        transaction_id: transactionId,
        role: role || null,
        name: name || null,
        email: email || null,
        phone: phone || null,
        position: count || 0,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error creating transaction contact:', error);
    return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 });
  }
}
