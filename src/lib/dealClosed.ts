import { supabaseServer } from './supabase';
import { getMutedTypes } from './notifications';
import { brokerageOwnersForDeal, overseesAgent } from './oversight';
import { commissionForTransaction } from './commissions';

// When a deal in a brokerage closes: the brokerage owner is told, with where the commission invoice stands, and the agent is
// nudged to generate theirs if they have not (unless they are the one who just closed it, who is looking right at the invoice box).
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
    const c = await commissionForTransaction(transactionId);
    const live = c && c.status !== 'void' ? c : null;
    const submitted = live?.status === 'change_requested' && !live.change_note;

    const ownerBody = !live ? 'There is no commission statement yet. Set the agent’s commission terms and one is created.'
      : live.status === 'estimate' ? `${live.statement_number} is still an estimate. Confirm the actual commission from the closing documents.`
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
