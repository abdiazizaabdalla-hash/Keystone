import { supabaseServer } from './supabase';
import { getDealPeople } from './dealPeople';
import { getMutedTypes } from './notifications';
import { hasAgentRole } from './appMetadata';
import { sendDealClosedEmail } from './agentPortalEmails';

import { CLOSED_MESSAGE_PREFIX } from './dealClosedMarker';

type Actor = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null; app_metadata?: Record<string, unknown> | null };

/**
 * One person closed a deal that other people are on (an agent and the coordinator, or two coordinators): say so in the deal's
 * chat, in the other people's bell, and by email, so nobody finds out by accident. Nothing happens for a deal only one person is on.
 * Never throws -- closing the deal must not fail because of this.
 */
export async function announceDealClosed(transactionId: string, actor: Actor, origin: string): Promise<void> {
  try {
    const { people, address } = await getDealPeople(transactionId);
    const others = people.filter((p) => p.userId !== actor.id);
    if (others.length === 0) return;

    const name = String(actor.user_metadata?.full_name || '').trim() || actor.email || 'The other party';
    const when = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const body = `${CLOSED_MESSAGE_PREFIX}${name} on ${when}`;

    const { error: chatError } = await supabaseServer.from('messages').insert({
      transaction_id: transactionId,
      sender_id: actor.id,
      sender_role: hasAgentRole(actor) ? 'agent' : 'tc',
      body,
    });
    if (chatError) console.error('Could not post the deal-closed line in the chat (non-fatal):', chatError);

    await Promise.all(
      others.map(async (person) => {
        try {
          const path = person.portal === 'agent' ? `/agent/transactions/${transactionId}` : `/dashboard/transactions/${transactionId}`;
          if (!(await getMutedTypes(person.userId)).includes('deal_closed')) {
            await supabaseServer.from('notifications').insert({
              recipient_user_id: person.userId,
              actor_user_id: actor.id,
              transaction_id: transactionId,
              event_type: 'deal_closed',
              title: `Deal closed by ${name}${address ? ` · ${address}` : ''}`.slice(0, 200),
              body: 'Every step is complete. Open the deal to see it.',
              link: path,
            });
          }
          if (person.email) {
            await sendDealClosedEmail({ toEmail: person.email, closedBy: name, propertyAddress: address, portalUrl: `${origin}${path}` });
          }
        } catch (error) {
          console.error('Could not tell one person the deal closed (non-fatal):', error);
        }
      })
    );
  } catch (error) {
    console.error('announceDealClosed failed (ignored):', error);
  }
}
