import { after } from 'next/server';
import { supabaseServer } from './supabase';

// The notification bell: one row in `notifications` per person per event,
// written here and read back by GET /api/notifications. Every writer in
// the app goes through queueDealNotification, which runs after the
// response is sent and swallows its own errors -- a failed notification
// must never fail (or slow down) the message, checkbox, or upload that
// triggered it.

export type NotificationType =
  | 'message'
  | 'task_completed'
  | 'date_changed'
  | 'document_added'
  | 'stage_changed'
  | 'client_viewed';

export const NOTIFICATION_TYPES: { type: NotificationType; label: string }[] = [
  { type: 'message', label: 'New messages' },
  { type: 'task_completed', label: 'Checklist steps completed' },
  { type: 'stage_changed', label: 'Stage changes' },
  { type: 'date_changed', label: 'Deadline changes' },
  { type: 'document_added', label: 'New documents' },
  { type: 'client_viewed', label: 'Client opened their progress link' },
];

const VALID_TYPES = new Set<string>(NOTIFICATION_TYPES.map((t) => t.type));
export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && VALID_TYPES.has(value);
}

// A burst of events of the same kind on the same deal folds into one
// unread row for this long, so a fast back-and-forth is one "4 new
// messages" row instead of four.
const COALESCE_WINDOW_MS = 15 * 60 * 1000;

export interface DealNotification {
  transactionId: string;
  /** The person who did the thing; never notified about their own action. */
  actorUserId: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** When set, a recent unread row of this type on this deal is updated instead of adding another. */
  coalesce?: { title: (count: number) => string };
}

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Everyone involved in a deal: the owning TC plus every agent who has accepted access. */
async function getDealParticipants(transactionId: string): Promise<{
  tcUserId: string | null;
  agentUserIds: string[];
  address: string | null;
}> {
  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('agent_id, property_address')
    .eq('id', transactionId)
    .maybeSingle();
  if (!transaction) return { tcUserId: null, agentUserIds: [], address: null };

  let tcUserId: string | null = null;
  if (transaction.agent_id) {
    const { data: agentRecord } = await supabaseServer
      .from('agents')
      .select('tc_user_id')
      .eq('id', transaction.agent_id)
      .maybeSingle();
    tcUserId = (agentRecord?.tc_user_id as string | null) ?? null;
  }

  const { data: grants } = await supabaseServer
    .from('transaction_agents')
    .select('agent_user_id')
    .eq('transaction_id', transactionId);

  return {
    tcUserId,
    agentUserIds: (grants || []).map((g) => g.agent_user_id as string),
    address: (transaction.property_address as string | null) ?? null,
  };
}

/** Event types this person has muted in the bell's settings (stored on their auth user_metadata). */
export async function getMutedTypes(userId: string): Promise<string[]> {
  try {
    const { data } = await supabaseServer.auth.admin.getUserById(userId);
    const muted = (data.user?.user_metadata as Record<string, unknown> | undefined)?.notification_muted;
    return Array.isArray(muted) ? muted.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

export async function notifyDeal(event: DealNotification): Promise<void> {
  try {
    const { tcUserId, agentUserIds, address } = await getDealParticipants(event.transactionId);
    const agentSet = new Set(agentUserIds);
    const recipients = [...new Set([...(tcUserId ? [tcUserId] : []), ...agentUserIds])].filter(
      (id) => id !== event.actorUserId
    );
    if (recipients.length === 0) return;

    const body = clip(event.body, 160);
    const titleSuffix = address ? ` · ${address}` : '';

    await Promise.all(
      recipients.map(async (recipientId) => {
        try {
          if ((await getMutedTypes(recipientId)).includes(event.type)) return;

          const link = agentSet.has(recipientId)
            ? `/agent/transactions/${event.transactionId}`
            : `/dashboard/transactions/${event.transactionId}`;

          if (event.coalesce) {
            const since = new Date(Date.now() - COALESCE_WINDOW_MS).toISOString();
            const { data: existing } = await supabaseServer
              .from('notifications')
              .select('id, event_count')
              .eq('recipient_user_id', recipientId)
              .eq('transaction_id', event.transactionId)
              .eq('event_type', event.type)
              .is('read_at', null)
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existing) {
              const count = ((existing.event_count as number) || 1) + 1;
              await supabaseServer
                .from('notifications')
                .update({
                  title: `${event.coalesce.title(count)}${titleSuffix}`,
                  body,
                  event_count: count,
                  actor_user_id: event.actorUserId,
                  created_at: new Date().toISOString(),
                })
                .eq('id', existing.id);
              return;
            }
          }

          await supabaseServer.from('notifications').insert({
            recipient_user_id: recipientId,
            actor_user_id: event.actorUserId,
            transaction_id: event.transactionId,
            event_type: event.type,
            title: `${event.title}${titleSuffix}`.slice(0, 200),
            body,
            link,
          });
        } catch (error) {
          console.error('Error writing notification for one recipient:', error);
        }
      })
    );
  } catch (error) {
    console.error('Error creating deal notification:', error);
  }
}

/** Fire-and-forget for request handlers: runs after the response has been sent. */
export function queueDealNotification(event: DealNotification): void {
  try {
    after(() => notifyDeal(event));
  } catch {
    // `after` can only run inside a request; if it ever isn't, skip rather than throw.
  }
}
