import { supabaseServer } from '@/lib/supabase';
import { googleCalendarAvailableFor } from '@/lib/googleCalendarAccess';

export interface DealCalendarAgent {
  userId: string;
  email: string | null;
  connected: boolean;
  /** Already connected, or on the Google Calendar allowlist (the connect button is hidden for everyone else until Google approves the app). */
  canConnect: boolean;
}

export interface DealCalendarStatus {
  /** False while Google verification is pending and this owner is not on the allowlist: the whole feature stays hidden. */
  available: boolean;
  ownerConnected: boolean;
  agents: DealCalendarAgent[];
  /** The deal's agent record has no Relay login yet (they have not accepted the invite). */
  agentNeedsInvite: boolean;
}

/** Who on this deal has a connected Google Calendar. Only the deal's owner should be shown this (callers check). */
export async function getDealCalendarStatus(transactionId: string, ownerId: string, ownerEmail: string | null | undefined): Promise<DealCalendarStatus> {
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
    agents.push({ userId, email, connected: connected.has(userId), canConnect: connected.has(userId) || googleCalendarAvailableFor(email) });
  }
  const ownerConnected = Boolean(ownerConn);
  return { available: ownerConnected || googleCalendarAvailableFor(ownerEmail), ownerConnected, agents, agentNeedsInvite: ids.length === 0 && Boolean(tx?.agent_id) };
}
