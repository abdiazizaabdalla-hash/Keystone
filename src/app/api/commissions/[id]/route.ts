import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { brokerageOn, overseesAgent } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { SplitError } from '@/lib/commissionMath';
import { isMissingTable, loadCommissionFor, notifyCommission, viewOf, type CommissionRow } from '@/lib/commissions';

// PATCH { action }
//   agent:  'accept' | 'request_change' (note) | 'set_preference' (preference: 'relay' | 'outside')
//   owner:  'approve' (an invoice the agent generated before this was an estimate) | 'mark_paid' (paidOn, note) | 'void'
// An ESTIMATE has no figures yet, so nothing can be accepted, approved or paid on it. The agent can still leave a note on it,
// which tells the brokerage what to fix before they confirm the actual commission (see POST /api/commissions).
// Each action checks the caller is that side of this commission and that the commission is in a state that allows it.

const today = () => new Date().toISOString().slice(0, 10);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const { id } = await params;
    const { row, side } = await loadCommissionFor(id, user.id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { updated_at: now };
    const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
    let notify: { recipientId: string; title: string; link: string } | null = null;
    // Each person has their own page for a deal: the owner oversees it from Collaborate, the agent works in it from Transactions.
    const link = side === 'agent' ? `/dashboard/collaborate/deals/${row.transaction_id}` : `/dashboard/transactions/${row.transaction_id}`;

    if (row.status === 'void') return bad('This commission was voided.', 409);

    if (side === 'agent') {
      if (action === 'accept') {
        if (row.status === 'estimate') return bad('This is an estimate. Your brokerage confirms the actual commission from the closing documents, then you can review and agree to it.', 409);
        if (row.status !== 'proposed') return bad(row.status === 'accepted' ? 'You already agreed to this split.' : 'There is nothing to accept right now.', 409);
        if (!(await overseesAgent(row.owner_user_id, user.id))) return bad('You are not in this brokerage right now.', 409);
        update.status = 'accepted';
        update.accepted_at = now;
        update.change_note = null;
        notify = { recipientId: row.owner_user_id, title: `${row.statement_number}: the agent agreed to the split`, link };
      } else if (action === 'request_change' && row.status === 'estimate') {
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (!note) return bad('Tell your brokerage what should change.');
        if (note.length > 1000) return bad('That note is too long (1,000 characters max).');
        // The estimate stays an estimate; the note is what the brokerage reads before confirming.
        update.change_note = note;
        notify = { recipientId: row.owner_user_id, title: `${row.statement_number}: the agent flagged something on the estimate`, link };
      } else if (action === 'request_change') {
        if (row.status !== 'proposed') return bad('You can only ask for a change while a proposal is waiting for you.', 409);
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (!note) return bad('Tell your brokerage what should change.');
        if (note.length > 1000) return bad('That note is too long (1,000 characters max).');
        update.status = 'change_requested';
        update.change_note = note;
        notify = { recipientId: row.owner_user_id, title: `${row.statement_number}: the agent asked for a change`, link };
      } else if (action === 'set_preference') {
        if (row.status === 'paid') return bad('This commission is already paid.', 409);
        if (body.preference !== 'relay' && body.preference !== 'outside') return bad('Choose how you want to be paid.');
        update.payment_preference = body.preference;
        notify = { recipientId: row.owner_user_id, title: `${row.statement_number}: the agent chose to be paid ${body.preference === 'relay' ? 'through Relay' : 'outside Relay'}`, link };
      } else {
        return bad('Unknown action.');
      }
    } else {
      if (action === 'approve') {
        if (row.status === 'estimate') return bad('Confirm the actual commission first. An estimate cannot be approved.', 409);
        if (row.status !== 'change_requested' || row.change_note) return bad('There is no agent invoice waiting for your approval.', 409);
        if (!(await overseesAgent(user.id, row.agent_user_id))) return bad('This agent is not in your brokerage right now.', 409);
        update.status = 'accepted';
        update.accepted_at = now;
        notify = { recipientId: row.agent_user_id, title: `${row.statement_number}: your brokerage approved your commission invoice`, link };
      } else if (action === 'mark_paid') {
        if (row.status === 'estimate') return bad('This is still an estimate. Confirm the actual commission, and let the agent review it, before marking it paid.', 409);
        if (row.status !== 'accepted') return bad('The agent has to agree to the split before it can be marked paid.', 409);
        const paidOn = typeof body.paidOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn) ? body.paidOn : today();
        if (paidOn > today()) return bad('The paid date cannot be in the future.');
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
        update.status = 'paid';
        update.paid_on = paidOn;
        update.paid_note = note || null;
        notify = { recipientId: row.agent_user_id, title: `${row.statement_number}: your commission was marked paid`, link };
      } else if (action === 'void') {
        if (row.status === 'paid') return bad('A paid commission cannot be voided.', 409);
        update.status = 'void';
        notify = { recipientId: row.agent_user_id, title: `${row.statement_number}: your brokerage voided this commission statement`, link };
      } else {
        return bad('Unknown action.');
      }
    }

    const { data, error } = await supabaseServer.from('deal_commissions').update(update).eq('id', row.id).eq('status', row.status).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return bad('That changed while you were looking. Reload and try again.', 409);
    await logAudit(request, user, `commission.${action}`, { entityType: 'commission', entityId: row.id, metadata: { transactionId: row.transaction_id, side } });
    if (notify) await notifyCommission({ ...notify, actorId: user.id, transactionId: row.transaction_id });
    return NextResponse.json(viewOf(data as CommissionRow));
  } catch (error) {
    if (error instanceof SplitError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (isMissingTable(error)) return NextResponse.json({ error: 'The database needs one more update before commissions work. Run add-brokerage-oversight.sql in Supabase.' }, { status: 500 });
    return oversightError(error, 'update the commission');
  }
}
