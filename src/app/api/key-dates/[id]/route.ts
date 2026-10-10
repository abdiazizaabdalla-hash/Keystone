import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { canAccessTransactionDates, cleanLabel, isValidIsoDate } from '@/lib/keyDates';

// PATCH: edit a critical date ({ dueDate?, label?, completed?, notifyAgent? }).
// DELETE: remove one.

async function loadAndAuthorize(request: NextRequest, id: string) {
  const { user, isAdmin } = await getUserFromRequest(request);
  if (isAgentUser(user)) return { error: NextResponse.json({ error: 'Not available' }, { status: 403 }) };
  await assertTrialActive(user);

  const { data: row } = await supabaseServer
    .from('transaction_key_dates')
    .select('id, transaction_id, label')
    .eq('id', id)
    .single();
  if (!row) return { error: NextResponse.json({ error: 'Date not found' }, { status: 404 }) };

  if (!(await canAccessTransactionDates(row.transaction_id as string, user.id, isAdmin))) {
    return { error: NextResponse.json({ error: 'You do not have permission to edit this date' }, { status: 403 }) };
  }
  return { row };
}

function handleError(error: unknown, what: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof TrialExpiredError) {
    return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  }
  console.error(`Error ${what} key date:`, error);
  return NextResponse.json({ error: `Failed to ${what} date` }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await loadAndAuthorize(request, id);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if ('dueDate' in body) {
      if (!isValidIsoDate(body.dueDate)) {
        return NextResponse.json({ error: 'dueDate must be YYYY-MM-DD' }, { status: 400 });
      }
      updates.due_date = body.dueDate;
    }
    if ('label' in body) updates.label = cleanLabel(body.label, auth.row!.label as string);
    if ('completed' in body) updates.completed = body.completed === true;
    if ('notifyAgent' in body) updates.notify_agent = body.notifyAgent === true;

    const { data, error } = await supabaseServer
      .from('transaction_key_dates')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return handleError(error, 'update');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await loadAndAuthorize(request, id);
    if (auth.error) return auth.error;

    const { error } = await supabaseServer.from('transaction_key_dates').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error, 'delete');
  }
}
