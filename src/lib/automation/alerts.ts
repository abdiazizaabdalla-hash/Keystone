import { supabaseServer } from '../supabase';
import { WINDOW_DAYS, alertOf, type Alert, type AlertKind, type AlertRow } from './alertCore';

export type { Alert, AlertKind } from './alertCore';

// What needs the person's eye on one deal or listing, as small banners: a draft email waiting for their OK, a reminder one of
// their automations raised, or an email that could not go. Reminders and problems stay until acknowledged. Whether something is
// acknowledged is kept in the action's own `result` (acknowledgedAt), so nothing else in the database changes.

export async function alertsFor(ownerId: string, scope: { transactionId?: string | null; listingId?: string | null }): Promise<Alert[]> {
  const col = scope.transactionId ? 'transaction_id' : 'listing_id';
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseServer
    .from('automation_actions')
    .select('id, kind, status, inputs, result, refusal_reason, created_at, executed_at, instance_id')
    .eq(col, (scope.transactionId ?? scope.listingId)!)
    .eq('owner_user_id', ownerId)
    .not('instance_id', 'is', null)
    .in('status', ['awaiting_approval', 'executed', 'refused', 'failed'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as AlertRow[];
  const ids = [...new Set(rows.map((r) => r.instance_id).filter((x): x is string => Boolean(x)))];
  const { data: insts } = ids.length ? await supabaseServer.from('automation_instances').select('id, name, status').in('id', ids) : { data: [] };
  const live = new Map((insts ?? []).filter((i) => i.status !== 'removed').map((i) => [i.id as string, i.name as string]));
  const out: Alert[] = [];
  for (const r of rows) {
    const name = r.instance_id ? live.get(r.instance_id) : undefined;
    if (name === undefined) continue; // the automation was removed: its banners go with it
    const a = alertOf(r, name);
    if (a) out.push(a);
  }
  // Waiting-for-you first, then problems, then reminders; newest first inside each.
  const rank: Record<AlertKind, number> = { approval: 0, problem: 1, reminder: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || Date.parse(b.at) - Date.parse(a.at));
}

/** Marks reminders and problems as seen. One action, or every open one on the file. Returns how many were acknowledged. */
export async function acknowledge(ownerId: string, target: { actionId: string } | { transactionId?: string | null; listingId?: string | null }): Promise<number> {
  const ids = 'actionId' in target ? [target.actionId] : (await alertsFor(ownerId, target)).filter((a) => a.kind !== 'approval').map((a) => a.id);
  let n = 0;
  for (const id of ids) {
    const { data: row } = await supabaseServer.from('automation_actions').select('id, status, result').eq('id', id).eq('owner_user_id', ownerId).not('instance_id', 'is', null).maybeSingle();
    if (!row || row.status === 'awaiting_approval') continue; // a draft is decided, not dismissed
    const { error } = await supabaseServer.from('automation_actions').update({ result: { ...((row.result as Record<string, unknown> | null) ?? {}), acknowledgedAt: new Date().toISOString() } }).eq('id', id).eq('owner_user_id', ownerId);
    if (!error) n++;
  }
  return n;
}
