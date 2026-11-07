import { supabaseServer } from './supabase';
import { dealOwnerUserId } from './coordinatorOnboarding';
import { getMutedTypes } from './notifications';

type Actor = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };

/**
 * A coordinator billed (or marked paid) an invoice on a deal someone else owns: tell that person in their bell, linking to their
 * Invoices page. Nothing happens on the coordinator's own deals. Never throws.
 */
export async function notifyDealOwnerOfInvoice(params: {
  transactionId: string;
  actor: Actor;
  invoiceNumber: string;
  amount: number;
  kind: 'created' | 'paid';
}): Promise<void> {
  try {
    const ownerId = await dealOwnerUserId(params.transactionId);
    if (!ownerId || ownerId === params.actor.id) return;
    if ((await getMutedTypes(ownerId)).includes('invoice')) return;
    const { data: tx } = await supabaseServer.from('transactions').select('property_address').eq('id', params.transactionId).maybeSingle();
    const name = String(params.actor.user_metadata?.full_name || '').trim() || params.actor.email || 'Your coordinator';
    const address = (tx?.property_address as string | null) || null;
    const money = `$${params.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const { error } = await supabaseServer.from('notifications').insert({
      recipient_user_id: ownerId,
      actor_user_id: params.actor.id,
      transaction_id: params.transactionId,
      event_type: 'invoice',
      title: (params.kind === 'created' ? `${name} sent you invoice ${params.invoiceNumber} (${money})` : `${name} marked invoice ${params.invoiceNumber} paid`).slice(0, 200),
      body: address,
      link: '/dashboard/invoices',
    });
    if (error) console.error('Could not add the invoice notice to the bell (non-fatal):', error);
  } catch (error) {
    console.error('notifyDealOwnerOfInvoice failed (ignored):', error);
  }
}
