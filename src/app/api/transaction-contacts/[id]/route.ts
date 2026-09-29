import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getVisibleTcUserIds } from '@/lib/team';

async function getOwnedContact(contactId: string, userId: string, isAdmin: boolean) {
  const { data: contact } = await supabaseServer
    .from('transaction_contacts')
    .select('id, transaction_id')
    .eq('id', contactId)
    .single();

  if (!contact) return { contact: null, allowed: false };
  if (isAdmin) return { contact, allowed: true };

  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('agent_id')
    .eq('id', contact.transaction_id)
    .single();

  if (!transaction) return { contact, allowed: false };

  const visibleIds = await getVisibleTcUserIds(userId);
  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', transaction.agent_id)
    .in('tc_user_id', visibleIds)
    .single();

  return { contact, allowed: Boolean(agent) };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: contactId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);

    const { contact, allowed } = await getOwnedContact(contactId, user.id, isAdmin);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: 'You do not have permission to edit this contact' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const update: Record<string, string | null> = {};
    for (const field of ['role', 'name', 'email', 'phone'] as const) {
      if (field in body) {
        const value = body[field];
        update[field] = typeof value === 'string' && value.trim() ? value.trim() : null;
      }
    }

    const { data, error } = await supabaseServer
      .from('transaction_contacts')
      .update(update)
      .eq('id', contactId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
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
    console.error('Error updating transaction contact:', error);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: contactId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);

    const { contact, allowed } = await getOwnedContact(contactId, user.id, isAdmin);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: 'You do not have permission to delete this contact' }, { status: 403 });
    }

    const { error } = await supabaseServer.from('transaction_contacts').delete().eq('id', contactId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting transaction contact:', error);
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
