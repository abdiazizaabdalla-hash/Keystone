import { supabaseServer } from './supabase';
import { getVisibleTcUserIds } from './team';
import { getPlanLimits } from './plans';
import { getUserPlan } from './privileged';
import { autoAddContact } from './contactsAuto';
import { hasAgentRole } from './appMetadata';
import { participantLevel } from './authorize';

export interface InvitingAgentProfile {
  id: string;
  name: string;
  /** True when this call made the profile; false when the coordinator already had one for this agent. */
  created: boolean;
}

type Person = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null; app_metadata?: Record<string, unknown> | null };

const num = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Runs when a coordinator accepts a deal an agent invited them onto. Puts the agent on the coordinator's Agents
 * list (at the coordinator's default fees, to be confirmed) and fills their Contacts from the deal: the agent
 * plus everyone listed on it. Safe to run again: it never duplicates or changes what's already there.
 * Never throws -- accepting the invitation must not fail because of this.
 */
export async function addInvitingAgentForCoordinator(params: {
  coordinator: Person;
  agent: Person;
  transactionId: string;
}): Promise<InvitingAgentProfile | null> {
  try {
    const { coordinator, agent, transactionId } = params;
    const agentEmail = (agent.email || '').trim().toLowerCase();
    if (!agentEmail) return null;
    const agentName = String(agent.user_metadata?.full_name || '').trim() || agentEmail;
    const phone = typeof agent.user_metadata?.phone === 'string' ? (agent.user_metadata.phone as string) : null;

    // The agent's brokerage, as the agent entered it on the deal, so brokerage-specific forms (IABS) can match.
    const { data: dealRow } = await supabaseServer.from('transactions').select('agents(brokerage)').eq('id', transactionId).maybeSingle();
    const rel = (dealRow as { agents?: { brokerage?: string | null } | { brokerage?: string | null }[] | null } | null)?.agents;
    const brokerage = ((Array.isArray(rel) ? rel[0]?.brokerage : rel?.brokerage) || '').trim() || null;

    // Contacts: the agent, then the people on the deal.
    await autoAddContact(coordinator.id, { name: agentName, email: agentEmail, phone, company: brokerage, role: 'Agent' });
    const { data: parties } = await supabaseServer
      .from('transaction_contacts')
      .select('name, email, phone, role')
      .eq('transaction_id', transactionId);
    for (const party of parties || []) {
      await autoAddContact(coordinator.id, { name: party.name as string | null, email: party.email as string | null, phone: party.phone as string | null, role: party.role as string | null }, { allowNameOnly: true });
    }

    // Agents list: reuse a profile for this email if the coordinator (or their team) already has one.
    const visibleIds = await getVisibleTcUserIds(coordinator.id);
    const { data: existing } = await supabaseServer
      .from('agents')
      .select('id, name')
      .in('tc_user_id', visibleIds)
      .ilike('email', agentEmail)
      .limit(1);
    if (existing && existing.length > 0) return { id: existing[0].id as string, name: existing[0].name as string, created: false };

    const { maxAgents } = getPlanLimits(getUserPlan(coordinator as Parameters<typeof getUserPlan>[0]));
    if (maxAgents !== null) {
      const { count } = await supabaseServer.from('agents').select('id', { count: 'exact', head: true }).eq('tc_user_id', coordinator.id);
      if ((count || 0) >= maxAgents) return null;
    }

    const { data: created, error } = await supabaseServer
      .from('agents')
      .insert({
        tc_user_id: coordinator.id,
        name: agentName,
        email: agentEmail,
        phone,
        brokerage,
        flat_fee: num(coordinator.user_metadata?.default_flat_fee, 400),
        commission_percent: num(coordinator.user_metadata?.default_percent_fee, 0),
      })
      .select('id, name')
      .single();
    if (error || !created) throw error || new Error('no row');
    return { id: created.id as string, name: created.name as string, created: true };
  } catch (error) {
    console.error('addInvitingAgentForCoordinator failed (ignored):', error);
    return null;
  }
}

/** Coordinators (paid or on trial) who were given this deal by its agent. */
async function coordinatorsOnDeal(transactionId: string): Promise<string[]> {
  const { data: links } = await supabaseServer.from('transaction_agents').select('agent_user_id').eq('transaction_id', transactionId);
  const ids: string[] = [];
  for (const link of links || []) {
    const { data } = await supabaseServer.auth.admin.getUserById(link.agent_user_id as string);
    const u = data.user;
    if (!u || hasAgentRole(u)) continue; // agent logins are collaborators, not coordinators
    if ((await participantLevel(u as Parameters<typeof participantLevel>[0])) === 'full') ids.push(u.id);
  }
  return ids;
}

/**
 * Someone was added to (or changed on) a deal: save them to the Contacts of every coordinator the deal was
 * shared with. Existing contacts are never changed. Never throws.
 */
export async function syncDealPartyToCoordinators(
  transactionId: string,
  person: { name?: string | null; email?: string | null; phone?: string | null; role?: string | null }
): Promise<void> {
  try {
    for (const id of await coordinatorsOnDeal(transactionId)) await autoAddContact(id, person, { allowNameOnly: true });
  } catch (error) {
    console.error('syncDealPartyToCoordinators failed (ignored):', error);
  }
}
