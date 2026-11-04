import { supabaseServer } from './supabase';
import { getMutedTypes } from './notifications';
import { brokerageOwnersForDeal, overseesAgent } from './oversight';
import { commissionForTransaction, ensureEstimateStatement } from './commissions';

// When a deal in a brokerage closes: the commission statement is created (an estimate), and the brokerage owner is told it closed and
// where the statement stands.
// Never throws: a failed notification must not fail the stage change.

async function put(recipientId: string, actorId: string | null, transactionId: string, type: string, title: string, body: string, link: string) {
  if ((await getMutedTypes(recipientId)).includes(type)) return;
  await supabaseServer.from('notifications').insert({ recipient_user_id: recipientId, actor_user_id: actorId, transaction_id: transactionId, event_type: type, title: title.slice(0, 200), body, link });
}

export async function notifyDealClosed(transactionId: string, actorId: string): Promise<void> {
  try {
    const owners = await brokerageOwnersForDeal(transactionId);
    if (owners.length === 0) return;
    const { data: tx } = await supabaseServer.from('transactions').select('property_address, tc_user_id').eq('id', transactionId).maybeSingle();
    if (!tx) return;
    const where = ` · ${tx.property_address ?? 'a deal'}`;
    const agentId = tx.tc_user_id as string;
    // The commission statement is born here, at closing, from the agent's commission rate and split. Nothing exists before.
    const c = (await commissionForTransaction(transactionId)) ?? (await ensureEstimateStatement(transactionId));
    const live = c && c.status !== 'void' ? c : null;
    const submitted = live?.status === 'change_requested' && !live.change_note;

    const ownerBody = !live ? 'It has closed. Set the agent’s commission terms and a commission statement is created.'
      : live.status === 'estimate' ? `It has closed. ${live.statement_number} is ready for you to confirm the actual commission from the closing documents.`
      : submitted ? `${live.statement_number} is waiting for your approval.`
      : live.status === 'accepted' ? `${live.statement_number} is approved. Mark it paid once the funds arrive.`
      : live.status === 'paid' ? `${live.statement_number} is already paid.`
      : `${live.statement_number} is still being agreed with the agent.`;
    const ownerLink = `/dashboard/collaborate/deals/${transactionId}`; // owners oversee a deal from Collaborate
    for (const ownerId of owners) {
      if (ownerId === actorId || !(await overseesAgent(ownerId, agentId))) continue;
      await put(ownerId, actorId, transactionId, 'deal_closed', `Deal closed${where}`, ownerBody, ownerLink);
    }
    // The agent is not asked to invoice anyone: the brokerage owner confirms the actual commission, and the agent is told then.
  } catch (error) {
    console.error('Deal-closed notification failed:', error);
  }
}
