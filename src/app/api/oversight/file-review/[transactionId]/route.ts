import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertBrokerageOwner, canOverseeDeal } from '@/lib/oversight';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { oversightError, sendBrokerageEmail } from '@/lib/oversightServer';
import { REVIEW_NOTE_MAX } from '@/lib/fileReview';

// PUT { status: 'reviewed' | 'flagged' | 'clear', note? }: the owner's review of one file. This is the owner's own record; it never
// changes the agent's deal. Flagging tells the agent (bell and email). Only deals of agents with an active link; others are 404.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ transactionId: string }> }) {
  try {
    const { transactionId } = await params;
    const { user } = await getUserFromRequest(request);
    await assertBrokerageOwner(user);
    await assertBrokerageManageable(user.id);
    if (!(await canOverseeDeal(user.id, transactionId))) throw new AuthError('Not found', 404);
    const body = (await request.json().catch(() => ({}))) as { status?: unknown; note?: unknown };
    const status = body.status;
    if (status !== 'reviewed' && status !== 'flagged' && status !== 'clear') return NextResponse.json({ error: 'Choose reviewed, flagged or clear.' }, { status: 400 });
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > REVIEW_NOTE_MAX) return NextResponse.json({ error: `The note is too long (${REVIEW_NOTE_MAX} characters max).` }, { status: 400 });

    if (status === 'clear') {
      const { error } = await supabaseServer.from('brokerage_file_reviews').delete().eq('owner_user_id', user.id).eq('transaction_id', transactionId);
      if (error) throw error;
      return NextResponse.json({ review: null });
    }

    const { error } = await supabaseServer.from('brokerage_file_reviews').upsert({ owner_user_id: user.id, transaction_id: transactionId, status, note: note || null, reviewed_at: new Date().toISOString() }, { onConflict: 'owner_user_id,transaction_id' });
    if (error) throw error;
    await logAudit(request, user, status === 'flagged' ? 'brokerage.file_flagged' : 'brokerage.file_reviewed', { entityType: 'transaction', entityId: transactionId });

    if (status === 'flagged') {
      const { data: tx } = await supabaseServer.from('transactions').select('tc_user_id, property_address').eq('id', transactionId).maybeSingle();
      if (tx?.tc_user_id) {
        const where = (tx.property_address as string | null) ?? 'one of your deals';
        const ownerLabel = (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) || user.email || 'Your brokerage';
        await supabaseServer
          .from('notifications')
          .insert({ recipient_user_id: tx.tc_user_id, actor_user_id: user.id, transaction_id: transactionId, event_type: 'brokerage_file_flagged', title: `Your brokerage flagged the file for ${where}`.slice(0, 200), link: `/dashboard/transactions/${transactionId}` })
          .then(({ error: e }) => e && console.error('File flag notification failed:', e));
        await sendBrokerageEmail({
          outboxOwnerId: user.id,
          fromLabel: ownerLabel,
          to: { userId: tx.tc_user_id as string },
          source: 'brokerage_file_flagged',
          subject: `Your brokerage flagged the file for ${where}`,
          paragraphs: [`${ownerLabel} reviewed the file for ${where} and flagged it for follow-up.`, note ? `Their note: ${note}` : 'Open the deal to check its documents.'],
          path: `/dashboard/transactions/${transactionId}`,
          linkLabel: 'Open the deal',
        });
      }
    }
    return NextResponse.json({ review: { status, note: note || null } });
  } catch (error) {
    return oversightError(error, 'save the file review');
  }
}
