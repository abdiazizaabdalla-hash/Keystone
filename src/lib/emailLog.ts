import { supabaseServer } from './supabase';
import { DUPLICATE_WINDOW_HOURS, findDuplicate, type LoggedEmail } from './emailLogCore';

// Server side of the email history (see emailLogCore.ts). Recording is best effort: a failed log write never undoes an email
// that already went out. Until add-deal-email-log.sql has been run these quietly do nothing.

export type EmailSource = 'step_button' | 'template' | 'automation';

export interface EmailScope {
  transactionId?: string | null;
  listingId?: string | null;
}

export async function logSentEmail(input: EmailScope & { ownerUserId: string; taskId?: string | null; source: EmailSource; to: string[]; subject: string; mode: 'sent' | 'outbox' }): Promise<void> {
  try {
    const { error } = await supabaseServer.from('deal_email_log').insert({
      owner_user_id: input.ownerUserId,
      transaction_id: input.transactionId ?? null,
      listing_id: input.listingId ?? null,
      task_id: input.taskId ?? null,
      source: input.source,
      to_emails: input.to.map((a) => a.trim().toLowerCase()),
      subject: input.subject.slice(0, 300),
      mode: input.mode,
    });
    if (error && error.code !== 'PGRST205' && error.code !== '42P01') console.error('logSentEmail failed (ignored):', error);
  } catch (error) {
    console.error('logSentEmail failed (ignored):', error);
  }
}

/** The emails already sent from this deal or listing in the last day or so (newest first). Empty if the table is not there yet. */
export async function recentEmails(scope: EmailScope, hours = 48): Promise<(LoggedEmail & { source: string })[]> {
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const id = scope.transactionId ?? scope.listingId;
  if (!id) return [];
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await supabaseServer.from('deal_email_log').select('task_id, to_emails, subject, sent_at, source').eq(col, id).gte('sent_at', since).order('sent_at', { ascending: false }).limit(200);
  if (error) return [];
  return (data ?? []) as (LoggedEmail & { source: string })[];
}

export async function findRecentDuplicate(scope: EmailScope, want: { taskId?: string | null; to: string[]; subject: string }): Promise<LoggedEmail | null> {
  return findDuplicate(await recentEmails(scope, DUPLICATE_WINDOW_HOURS + 1), want, new Date());
}
