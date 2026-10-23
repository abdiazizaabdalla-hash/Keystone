import { supabaseServer } from '@/lib/supabase';

export interface DealCalendarAgent {
  userId: string;
  email: string | null;
  connected: boolean;
}

export interface DealCalendarStatus {
  ownerConnected: boolean;
  agents: DealCalendarAgent[];
  /** The deal's agent record has no Relay login yet (they have not accepted the invite). */
  agentNeedsInvite: boolean;
}

/** Who on this deal has a connected Google Calendar. Only the deal's owner should be shown this (callers check). */
export async function getDealCalendarStatus(transactionId: string, ownerId: string): Promise<DealCalendarStatus> {
  const [{ data: links }, { data: ownerConn }, { data: tx }] = await Promise.all([
    supabaseServer.from('transaction_agents').select('agent_user_id').eq('transaction_id', transactionId),
    supabaseServer.from('calendar_connections').select('tc_user_id').eq('tc_user_id', ownerId).eq('provider', 'google').maybeSingle(),
    supabaseServer.from('transactions').select('agent_id').eq('id', transactionId).maybeSingle(),
  ]);
  const ids = Array.from(new Set((links || []).map((l) => l.agent_user_id as string)));
  const { data: conns } = ids.length
    ? await supabaseServer.from('calendar_connections').select('tc_user_id').in('tc_user_id', ids).eq('provider', 'google')
    : { data: [] as { tc_user_id: string }[] };
  const connected = new Set((conns || []).map((c) => c.tc_user_id as string));

  const agents: DealCalendarAgent[] = [];
  for (const userId of ids) {
    let email: string | null = null;
    try {
      const { data } = await supabaseServer.auth.admin.getUserById(userId);
      email = data?.user?.email ?? null;
    } catch {
      email = null;
    }
    agents.push({ userId, email, connected: connected.has(userId) });
  }
  return { ownerConnected: Boolean(ownerConn), agents, agentNeedsInvite: ids.length === 0 && Boolean(tx?.agent_id) };
}
