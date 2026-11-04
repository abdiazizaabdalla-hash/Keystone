import { supabaseServer } from './supabase';
import { getMutedTypes } from './notifications';
import { overseesAgent } from './oversight';
import { commissionNudges, type NudgeCommission, type NudgeDeal } from './commissionNudgeRules';

export * from './commissionNudgeRules';

// The runner the daily cron calls: looks at every active brokerage link and writes the nudges that are due, each as a bell
// notification, never repeating one sooner than its own interval. See commissionNudgeRules for what triggers each.

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** Looks at every active brokerage link and writes the nudges that are due. Returns how many were written. */
export async function runCommissionNudges(today: string): Promise<{ created: number; considered: number }> {
  const { data: links } = await supabaseServer.from('brokerage_links').select('owner_user_id, agent_user_id').eq('status', 'active').not('agent_user_id', 'is', null).limit(2000);
  const ownerByAgent = new Map<string, string>();
  for (const l of links ?? []) {
    const agentId = l.agent_user_id as string;
    const ownerId = l.owner_user_id as string;
    if (await overseesAgent(ownerId, agentId)) ownerByAgent.set(agentId, ownerId);
  }
  const agentIds = [...ownerByAgent.keys()];
  if (agentIds.length === 0) return { created: 0, considered: 0 };

  const deals: NudgeDeal[] = [];
  const commissions: NudgeCommission[] = [];
  for (const ids of chunk(agentIds, 80)) {
    const { data: tx } = await supabaseServer.from('transactions').select('id, property_address, status, closing_date, updated_at, tc_user_id').in('tc_user_id', ids).limit(5000);
    for (const t of tx ?? []) deals.push({ id: t.id as string, address: t.property_address as string | null, status: t.status as string | null, closingDate: (t.closing_date as string | null)?.slice(0, 10) ?? null, updatedAt: t.updated_at as string | null, agentId: t.tc_user_id as string });
    const { data: cm } = await supabaseServer.from('deal_commissions').select('id, transaction_id, statement_number, status, change_note, owner_user_id, agent_user_id, proposed_at, accepted_at').in('agent_user_id', ids).limit(5000);
    for (const c of cm ?? []) commissions.push({ id: c.id as string, transactionId: c.transaction_id as string, statementNumber: c.statement_number as string, status: c.status as string, changeNote: c.change_note as string | null, ownerId: c.owner_user_id as string, agentId: c.agent_user_id as string, proposedAt: c.proposed_at as string, acceptedAt: c.accepted_at as string | null });
  }

  const nudges = commissionNudges({ deals, commissions, ownerOf: (a) => ownerByAgent.get(a) ?? null, today });
  let created = 0;
  for (const n of nudges) {
    try {
      if ((await getMutedTypes(n.recipientId)).includes('commission')) continue;
      const since = new Date(Date.now() - n.repeatDays * 86_400_000).toISOString();
      const { data: recent } = await supabaseServer.from('notifications').select('id').eq('recipient_user_id', n.recipientId).eq('link', n.link).gte('created_at', since).limit(1);
      if (recent && recent.length > 0) continue;
      const { error } = await supabaseServer.from('notifications').insert({ recipient_user_id: n.recipientId, actor_user_id: null, transaction_id: n.transactionId, event_type: 'commission', title: n.title.slice(0, 200), link: n.link });
      if (!error) created += 1;
    } catch (error) {
      console.error('Commission nudge failed:', error);
    }
  }
  return { created, considered: nudges.length };
}
