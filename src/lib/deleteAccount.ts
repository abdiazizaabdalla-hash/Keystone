import { supabaseServer } from './supabase';
import { stripe } from './stripe';

const BUCKET = 'transaction-documents';

// Permanently removes a user and everything that belongs to them: their
// deals and everything attached to them (tasks, invoices, documents and the
// files in storage, messages, contacts, key dates, signing requests, emails,
// share links), their agents, checklist templates, payment/calendar
// connections, their team (if they are its only member) and finally the
// sign-in account itself. Any Stripe subscription is cancelled first.
//
// Refuses (throws DeleteAccountError) if the user owns a Team that still has
// other members: deleting would silently remove those people's workspace.
// Not reversible.

export class DeleteAccountError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function deleteWhere(table: string, column: string, values: string[]): Promise<void> {
  if (values.length === 0) return;
  // Chunked so a big account doesn't blow the URL length limit on `in (...)`.
  for (let i = 0; i < values.length; i += 100) {
    const { error } = await supabaseServer.from(table).delete().in(column, values.slice(i, i + 100));
    if (error) throw new Error(`Failed clearing ${table}: ${error.message}`);
  }
}

export async function deleteUserCompletely(userId: string): Promise<{ transactions: number; files: number }> {
  // --- Team: owner with other members is a stop; otherwise tear it down.
  const { data: membership } = await supabaseServer
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  let teamIdToRemove: string | null = null;
  if (membership) {
    if (membership.role === 'owner') {
      const { count } = await supabaseServer
        .from('team_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('team_id', membership.team_id);
      if ((count ?? 0) > 1) {
        throw new DeleteAccountError('This user owns a Team that still has other members. Remove them from the team first.', 409);
      }
      teamIdToRemove = membership.team_id as string;
    }
  }

  // --- Stripe: stop billing before the data goes.
  const { data: stripeRow } = await supabaseServer
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  const customerId = stripeRow?.stripe_customer_id as string | undefined;
  if (customerId && customerId.startsWith('cus_')) {
    try {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
      for (const sub of subs.data) {
        if (['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      // A customer that no longer exists (e.g. a test-mode id) has nothing to cancel.
      if (code !== 'resource_missing') {
        throw new DeleteAccountError(`Couldn't cancel this user's Stripe subscription, so nothing was deleted: ${(error as Error).message}`, 502);
      }
    }
  }

  // --- Collect the user's deals (by owner column and via their agents).
  const { data: agentRows } = await supabaseServer.from('agents').select('id').eq('tc_user_id', userId);
  const agentIds = (agentRows || []).map((a) => a.id as string);

  const txIds = new Set<string>();
  const { data: ownedTx } = await supabaseServer.from('transactions').select('id').eq('tc_user_id', userId);
  (ownedTx || []).forEach((t) => txIds.add(t.id as string));
  for (let i = 0; i < agentIds.length; i += 100) {
    const { data: viaAgent } = await supabaseServer
      .from('transactions')
      .select('id')
      .in('agent_id', agentIds.slice(i, i + 100));
    (viaAgent || []).forEach((t) => txIds.add(t.id as string));
  }
  const transactionIds = [...txIds];

  // --- Files in storage first (the rows that point at them go next).
  let files = 0;
  if (transactionIds.length > 0) {
    const paths: string[] = [];
    for (let i = 0; i < transactionIds.length; i += 100) {
      const { data: docs } = await supabaseServer
        .from('documents')
        .select('storage_path')
        .in('transaction_id', transactionIds.slice(i, i + 100));
      (docs || []).forEach((d) => d.storage_path && paths.push(d.storage_path as string));
      const { data: signing } = await supabaseServer
        .from('signing_requests')
        .select('source_storage_path')
        .in('transaction_id', transactionIds.slice(i, i + 100));
      (signing || []).forEach((r) => r.source_storage_path && paths.push(r.source_storage_path as string));
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabaseServer.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (error) console.error('Error removing stored files during account deletion (continuing):', error);
    }
    files = paths.length;
  }

  // --- Rows hanging off the deals. Order matters where one points at another.
  await deleteWhere('messages', 'sender_id', [userId]);
  for (const table of [
    'messages',
    'signing_requests',
    'documents',
    'transaction_emails',
    'transaction_contacts',
    'transaction_key_dates',
    'external_access_links',
    'transaction_agents',
    'agent_invites',
    'tasks',
    'invoices',
  ]) {
    await deleteWhere(table, 'transaction_id', transactionIds);
  }
  await deleteWhere('transactions', 'id', transactionIds);
  await deleteWhere('agents', 'id', agentIds);

  // --- Things the user owns directly.
  await deleteWhere('agent_invites', 'invited_by', [userId]);
  await deleteWhere('transaction_agents', 'invited_by', [userId]);
  await deleteWhere('transaction_agents', 'agent_user_id', [userId]);
  await deleteWhere('checklist_templates', 'tc_user_id', [userId]);
  await deleteWhere('payment_accounts', 'tc_user_id', [userId]);
  await deleteWhere('calendar_connections', 'tc_user_id', [userId]);
  await deleteWhere('key_date_calendar_events', 'user_id', [userId]);
  await deleteWhere('calendar_feed_tokens', 'user_id', [userId]);
  await deleteWhere('contacts', 'tc_user_id', [userId]);
  await deleteWhere('step_email_templates', 'tc_user_id', [userId]);
  await deleteWhere('team_invites', 'invited_by', [userId]);
  await deleteWhere('team_message_reads', 'user_id', [userId]);
  await deleteWhere('team_messages', 'sender_id', [userId]);
  await deleteWhere('team_members', 'user_id', [userId]);
  if (teamIdToRemove) {
    await deleteWhere('team_invites', 'team_id', [teamIdToRemove]);
    await deleteWhere('team_messages', 'team_id', [teamIdToRemove]);
    await deleteWhere('brokerage_agents', 'team_id', [teamIdToRemove]);
    await deleteWhere('teams', 'id', [teamIdToRemove]);
  }
  await deleteWhere('stripe_customers', 'user_id', [userId]);

  // --- The sign-in account itself.
  const { error: authError } = await supabaseServer.auth.admin.deleteUser(userId);
  if (authError) throw new Error(`Failed deleting the sign-in account: ${authError.message}`);

  return { transactions: transactionIds.length, files };
}
