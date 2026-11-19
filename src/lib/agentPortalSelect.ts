import { supabaseServer } from '@/lib/supabase';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { inviteAgentToTransaction, sendListingPortalInvite, agentSetupUrl } from '@/lib/agentInvite';
import { sendAgentAccessSummaryEmail } from '@/lib/agentPortalEmails';
import { queueCalendarSync } from '@/lib/calendarSync';

// Per-agent choice of which deals and listings the agent can see in the portal (Agents page -> Portal access).
// Deals: a row in transaction_agents for the agent's login. Listings: "Share with the agent" on the listing.

type Actor = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const CLOSED = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1];

export type AccessItem = { id: string; address: string; status: string; hasAccess: boolean };
export type AgentAccessList = { email: string | null; deals: AccessItem[]; listings: AccessItem[] };

/** Logins (by user id) that belong to this agent's email, per deal. Revoking must only remove this agent, never anyone else on the deal. */
async function agentUserIdsByDeal(txIds: string[], email: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (txIds.length === 0) return out;
  const { data: rows } = await supabaseServer.from('transaction_agents').select('transaction_id, agent_user_id').in('transaction_id', txIds);
  const cache = new Map<string, boolean>();
  for (const r of rows || []) {
    const uid = r.agent_user_id as string;
    if (!cache.has(uid)) {
      const { data } = await supabaseServer.auth.admin.getUserById(uid);
      cache.set(uid, norm(data?.user?.email) === email);
    }
    if (cache.get(uid)) out.set(r.transaction_id as string, [...(out.get(r.transaction_id as string) || []), uid]);
  }
  return out;
}

export async function listAgentAccess(agentId: string): Promise<AgentAccessList | null> {
  const { data: agent } = await supabaseServer.from('agents').select('id, email').eq('id', agentId).maybeSingle();
  if (!agent) return null;
  const email = norm(agent.email);
  const { data: txs } = await supabaseServer.from('transactions').select('id, property_address, status').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(200);
  const open = (txs || []).filter((t) => t.status !== CLOSED);
  const has = email.includes('@') ? await agentUserIdsByDeal(open.map((t) => t.id as string), email) : new Map<string, string[]>();
  const { data: lists } = await supabaseServer.from('listings').select('id, property_address, status, share_with_agent').eq('agent_id', agentId).in('status', ['preparing', 'active', 'under_offer']).order('created_at', { ascending: false }).limit(200);
  return {
    email: email || null,
    deals: open.map((t) => ({ id: t.id as string, address: (t.property_address as string) || 'Untitled deal', status: t.status as string, hasAccess: has.has(t.id as string) })),
    listings: (lists || []).map((l) => ({ id: l.id as string, address: (l.property_address as string) || 'Untitled listing', status: l.status as string, hasAccess: l.share_with_agent === true })),
  };
}

export type SetAccessResult = { ok: boolean; reason?: 'no_agent' | 'no_email'; granted: number; removed: number; emailed: boolean };

/** Makes the agent's access match exactly the chosen deals and listings (only among the ones listed above). One summary email for new access. */
export async function setAgentAccess(params: { agentId: string; dealIds: string[]; listingIds: string[]; user: Actor; appUrl: string }): Promise<SetAccessResult> {
  const { agentId, user, appUrl } = params;
  const none = { granted: 0, removed: 0, emailed: false };
  const current = await listAgentAccess(agentId);
  if (!current) return { ok: false, reason: 'no_agent', ...none };
  if (!current.email || !current.email.includes('@') || current.email === norm(user.email)) return { ok: false, reason: 'no_email', ...none };
  const wantDeals = new Set(params.dealIds);
  const wantListings = new Set(params.listingIds);
  let granted = 0, removed = 0, grantedDeals = 0, grantedListings = 0;

  const revokeDeals = current.deals.filter((d) => d.hasAccess && !wantDeals.has(d.id)).map((d) => d.id);
  if (revokeDeals.length) {
    const byDeal = await agentUserIdsByDeal(revokeDeals, current.email);
    for (const [txId, uids] of byDeal) {
      await supabaseServer.from('transaction_agents').delete().eq('transaction_id', txId).in('agent_user_id', uids);
      await supabaseServer.from('agent_invites').delete().eq('transaction_id', txId).eq('email', current.email);
      queueCalendarSync(txId);
      removed += 1;
    }
  }
  for (const d of current.deals.filter((x) => !x.hasAccess && wantDeals.has(x.id))) {
    // A stale invite row (accepted before, then revoked elsewhere) would make the invite say "already": clear it first.
    await supabaseServer.from('agent_invites').delete().eq('transaction_id', d.id).eq('email', current.email);
    const out = await inviteAgentToTransaction({ transaction: { id: d.id, agent_id: agentId, property_address: d.address }, user, appUrl, silent: true });
    if (out === 'sent') { granted += 1; grantedDeals += 1; }
  }
  const revokeListings = current.listings.filter((l) => l.hasAccess && !wantListings.has(l.id)).map((l) => l.id);
  if (revokeListings.length) {
    await supabaseServer.from('listings').update({ share_with_agent: false }).eq('agent_id', agentId).in('id', revokeListings);
    removed += revokeListings.length;
  }
  for (const l of current.listings.filter((x) => !x.hasAccess && wantListings.has(x.id))) {
    await supabaseServer.from('listings').update({ share_with_agent: true }).eq('id', l.id).eq('agent_id', agentId);
    const out = await sendListingPortalInvite({ listing: { id: l.id, agent_id: agentId, share_with_agent: true, property_address: l.address }, user, appUrl, silent: true });
    if (out === 'sent' || out === 'already') { granted += 1; grantedListings += 1; }
  }

  let emailed = false;
  if (grantedDeals + grantedListings > 0) {
    try {
      const tcLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'Your transaction coordinator';
      await sendAgentAccessSummaryEmail({ toEmail: current.email, tcLabel, deals: grantedDeals, listings: grantedListings, loginUrl: agentSetupUrl(appUrl, current.email), ownerUserId: user.id });
      emailed = true;
    } catch (err) {
      console.error('Could not send the agent access summary email (access was still saved):', err);
    }
  }
  return { ok: true, granted, removed, emailed };
}
