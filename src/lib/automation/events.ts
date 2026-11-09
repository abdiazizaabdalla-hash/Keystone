import { isFeatureOn } from '../features';
import { supabaseServer } from '../supabase';
import { emitEvent, type EventStore } from './eventCore';
import type { EventType } from './types';

// Database side of the event log: the Supabase store, the owner lookup, and the helper route handlers call.
// Rules and dedupe behaviour are documented in eventCore.ts.
export { emitEvent, buildEventRow } from './eventCore';
export type { NewEvent, EventRow, EventStore } from './eventCore';

export const supabaseEventStore: EventStore = {
  async insert(row) {
    const { data, error } = await supabaseServer
      .from('transaction_events')
      .upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },
};

/** Who automation runs for on a deal: the coordinator on it, else the coordinator who owns the deal's agent. */
export async function dealAutomationOwner(transactionId: string): Promise<string | null> {
  const { data } = await supabaseServer.from('transactions').select('tc_user_id, agent_id').eq('id', transactionId).maybeSingle();
  if (!data) return null;
  if (data.tc_user_id) return data.tc_user_id as string;
  const { data: agent } = await supabaseServer.from('agents').select('tc_user_id').eq('id', data.agent_id as string).maybeSingle();
  return (agent?.tc_user_id as string | undefined) ?? null;
}

/** For route handlers: finds the deal's automation owner, then records the event. Inert and cheap when the flag is off. */
export async function emitDealEvent(
  transactionId: string,
  type: EventType,
  payload: Record<string, unknown> = {},
  dedupeKey?: string
): Promise<void> {
  if (!isFeatureOn('automation')) return;
  try {
    const ownerUserId = await dealAutomationOwner(transactionId);
    if (ownerUserId) await emitEvent({ ownerUserId, transactionId, type, payload, dedupeKey }, { store: supabaseEventStore });
  } catch (err) {
    console.error('Automation event failed:', err);
  }
}
