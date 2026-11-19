import { supabaseServer } from './supabase';
import { hasAgentRole } from './appMetadata';
import { getEntitlements } from './entitlements';

// Who is on a deal, for messages and notifications. A deal has an owner (whoever's workspace holds it) and anyone
// they added. Which side a person is on follows their account, not the order they joined: an agent login is the
// agent side, everyone else the coordinator side. Free agent logins read the deal in the limited portal (/agent),
// everyone else in the normal workspace (/dashboard).

export type DealSide = 'agent' | 'tc';

export interface DealPerson {
  userId: string;
  email: string | null;
  side: DealSide;
  /** Where this person opens the deal. */
  portal: 'agent' | 'dashboard';
}

export async function getDealPeople(transactionId: string): Promise<{ people: DealPerson[]; address: string | null }> {
  const { data: tx } = await supabaseServer.from('transactions').select('agent_id, property_address').eq('id', transactionId).maybeSingle();
  if (!tx) return { people: [], address: null };

  const ids: string[] = [];
  if (tx.agent_id) {
    const { data: record } = await supabaseServer.from('agents').select('tc_user_id').eq('id', tx.agent_id).maybeSingle();
    if (record?.tc_user_id) ids.push(record.tc_user_id as string);
  }
  const { data: grants } = await supabaseServer.from('transaction_agents').select('agent_user_id').eq('transaction_id', transactionId);
  for (const g of grants || []) ids.push(g.agent_user_id as string);

  const people: DealPerson[] = [];
  for (const id of [...new Set(ids)]) {
    const { data } = await supabaseServer.auth.admin.getUserById(id);
    const u = data.user;
    if (!u) continue;
    people.push({
      userId: u.id,
      email: u.email ?? null,
      side: hasAgentRole(u) ? 'agent' : 'tc',
      portal: getEntitlements(u).isCollaborator ? 'agent' : 'dashboard',
    });
  }
  return { people, address: (tx.property_address as string | null) ?? null };
}

/** Which side of a deal a signed-in account speaks for. An admin acts as the coordinator side. */
export function messageSide(user: Parameters<typeof hasAgentRole>[0], isAdmin: boolean): DealSide {
  return !isAdmin && hasAgentRole(user) ? 'agent' : 'tc';
}
