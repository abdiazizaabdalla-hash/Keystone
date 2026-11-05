import { supabaseServer } from './supabase';
import { agentLabels, loadOversightDeals, loadOversightListings, overseesAgent, rosterStats } from './oversight';
import { sendBrokerageEmail } from './oversightServer';
import { digestParagraphs, digestSubject, type DigestAgent } from './brokerageDigestRules';

export * from './brokerageDigestRules';

// The runner the weekly cron calls: one email to each brokerage owner with a line per agent (open deals, what is late, what
// closes this week). Owners with no joined agents get nothing. See brokerageDigestRules for the wording.

/** Sends the weekly digest to every brokerage owner who has agents. Returns how many emails went out. */
export async function runBrokerageDigest(today: string): Promise<{ sent: number; owners: number }> {
  const { data: links } = await supabaseServer.from('brokerage_links').select('owner_user_id, agent_user_id').eq('status', 'active').not('agent_user_id', 'is', null).limit(5000);
  const byOwner = new Map<string, string[]>();
  for (const l of links ?? []) {
    const ownerId = l.owner_user_id as string;
    const agentId = l.agent_user_id as string;
    if (await overseesAgent(ownerId, agentId)) byOwner.set(ownerId, [...(byOwner.get(ownerId) ?? []), agentId]);
  }
  let sent = 0;
  for (const [ownerId, agentIds] of byOwner) {
    try {
      const [labels, deals, listings] = await Promise.all([agentLabels(agentIds), loadOversightDeals(agentIds, today), loadOversightListings(agentIds, today)]);
      const end = new Date(`${today}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 7);
      const weekEnd = end.toISOString().slice(0, 10);
      const agents: DigestAgent[] = agentIds.map((id) => {
        const mine = deals.filter((d) => d.tc_user_id === id);
        const stats = rosterStats(mine, listings.filter((x) => x.tc_user_id === id), today);
        const closing = mine.filter((d) => d.status !== 'Closed' && d.closing_date && d.closing_date.slice(0, 10) >= today && d.closing_date.slice(0, 10) <= weekEnd);
        return { name: labels.get(id)?.name ?? 'Agent', openDeals: stats.openDeals, lateTasks: stats.lateTasks, closingThisWeek: stats.closingThisWeek, closingAddresses: closing.map((d) => d.property_address ?? 'A deal') };
      });
      const paragraphs = digestParagraphs(agents);
      if (!paragraphs) continue;
      const result = await sendBrokerageEmail({ outboxOwnerId: ownerId, fromLabel: 'Relay TC', to: { userId: ownerId }, source: 'brokerage_digest', subject: digestSubject(agents), paragraphs, path: '/dashboard/collaborate#agents', linkLabel: 'Open your agents' });
      if (result === 'sent' || result === 'outbox') sent += 1;
    } catch (error) {
      console.error('Brokerage digest failed for one owner:', error);
    }
  }
  return { sent, owners: byOwner.size };
}
