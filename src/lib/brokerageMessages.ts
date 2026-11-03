import { supabaseServer } from './supabase';
import { isTeamPlan } from './plans';
import { getUserPlan, type WithAppMetadata } from './appMetadata';

// Private messages between a brokerage owner and one of their agents. A thread belongs to exactly two people
// (the owner and that agent); nobody else on the team can read it. Access needs an ACTIVE brokerage link and an
// owner who is still on a Team or Brokerage plan, the same rule that governs oversight.

export const BROKERAGE_MESSAGE_MAX = 4000;

export interface BrokerageMessageRow {
  id: string;
  owner_user_id: string;
  agent_user_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Pair {
  ownerId: string;
  agentId: string;
  /** Which side the caller is on. */
  me: 'owner' | 'agent';
}

async function ownerOnTeamPlan(ownerId: string): Promise<boolean> {
  const { data } = await supabaseServer.auth.admin.getUserById(ownerId);
  return Boolean(data.user) && isTeamPlan(getUserPlan(data.user as WithAppMetadata));
}

/** The brokerage link between the caller and `otherId`, if there is a live one. Null otherwise (also for strangers). */
export async function resolvePair(meId: string, otherId: string): Promise<Pair | null> {
  if (!meId || !otherId || meId === otherId) return null;
  const asOwner = await supabaseServer.from('brokerage_links').select('id').eq('owner_user_id', meId).eq('agent_user_id', otherId).eq('status', 'active').maybeSingle();
  if (asOwner.data && (await ownerOnTeamPlan(meId))) return { ownerId: meId, agentId: otherId, me: 'owner' };
  const asAgent = await supabaseServer.from('brokerage_links').select('id').eq('owner_user_id', otherId).eq('agent_user_id', meId).eq('status', 'active').maybeSingle();
  if (asAgent.data && (await ownerOnTeamPlan(otherId))) return { ownerId: otherId, agentId: meId, me: 'agent' };
  return null;
}

/** Everyone the caller can message right now: their agents (as owner) and their brokerage owner (as agent). */
export async function messagePartners(meId: string): Promise<{ id: string; role: 'agent' | 'owner' }[]> {
  const out: { id: string; role: 'agent' | 'owner' }[] = [];
  const mine = await supabaseServer.from('brokerage_links').select('agent_user_id').eq('owner_user_id', meId).eq('status', 'active');
  const agents = (mine.data ?? []).map((r) => r.agent_user_id as string).filter(Boolean);
  if (agents.length > 0 && (await ownerOnTeamPlan(meId))) for (const id of agents) out.push({ id, role: 'agent' });
  const joined = await supabaseServer.from('brokerage_links').select('owner_user_id').eq('agent_user_id', meId).eq('status', 'active').maybeSingle();
  const ownerId = joined.data?.owner_user_id as string | undefined;
  if (ownerId && (await ownerOnTeamPlan(ownerId))) out.push({ id: ownerId, role: 'owner' });
  return out;
}

/** Newest message and unread count per other person, from the caller's recent messages. */
export function summarise(meId: string, rows: Pick<BrokerageMessageRow, 'owner_user_id' | 'agent_user_id' | 'sender_id' | 'body' | 'created_at' | 'read_at'>[]) {
  const last = new Map<string, { fromMe: boolean; body: string; createdAt: string }>();
  const unread = new Map<string, number>();
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const m of sorted) {
    const other = m.owner_user_id === meId ? m.agent_user_id : m.owner_user_id;
    if (!last.has(other)) last.set(other, { fromMe: m.sender_id === meId, body: m.body, createdAt: m.created_at });
    if (m.sender_id !== meId && !m.read_at) unread.set(other, (unread.get(other) ?? 0) + 1);
  }
  return { last, unread };
}
