import { supabaseServer } from '@/lib/supabase';

// General coordinator <-> agent messages (see add-direct-messages.sql). One conversation per pair,
// keyed by the coordinator's user id and the agent's login email. Deal and listing messages are separate.

export const DIRECT_MESSAGE_MAX = 4000;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const normEmail = (e: string | null | undefined) => (e || '').trim().toLowerCase();

export interface DirectMessageRow {
  id: string;
  tc_user_id: string;
  agent_email: string;
  sender_role: 'tc' | 'agent';
  body: string;
  created_at: string;
}

export async function userLabel(userId: string): Promise<{ label: string; email: string | null }> {
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  const email = data.user?.email ?? null;
  return { label: (data.user?.user_metadata?.full_name as string | undefined)?.trim() || email || 'Transaction coordinator', email };
}

/** Coordinators an agent may message: whoever has them on an agent record, or has put them on a deal, or already talks to them. */
export async function tcIdsForAgent(agentUserId: string, agentEmail: string): Promise<string[]> {
  const email = normEmail(agentEmail);
  if (!email) return [];
  const ids = new Set<string>();

  const { data: records } = await supabaseServer.from('agents').select('tc_user_id').ilike('email', escapeLike(email)).limit(200);
  for (const r of records || []) if (r.tc_user_id) ids.add(r.tc_user_id as string);

  const { data: links } = await supabaseServer.from('transaction_agents').select('transaction_id').eq('agent_user_id', agentUserId).limit(500);
  const txIds = (links || []).map((l) => l.transaction_id as string);
  if (txIds.length) {
    const { data: txs } = await supabaseServer.from('transactions').select('agent_id').in('id', txIds);
    const agentIds = [...new Set((txs || []).map((t) => t.agent_id as string).filter(Boolean))];
    if (agentIds.length) {
      const { data: owners } = await supabaseServer.from('agents').select('tc_user_id').in('id', agentIds);
      for (const o of owners || []) if (o.tc_user_id) ids.add(o.tc_user_id as string);
    }
  }

  const { data: past } = await supabaseServer.from('direct_messages').select('tc_user_id').eq('agent_email', email).limit(500);
  for (const p of past || []) ids.add(p.tc_user_id as string);
  return [...ids];
}

/** Agents a coordinator may message: their agent records with an email, agents on their deals, and anyone already in a thread. */
export async function agentsForTc(tcUserId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // email -> display name
  const { data: records } = await supabaseServer.from('agents').select('id, name, email').eq('tc_user_id', tcUserId).limit(500);
  const recordIds: string[] = [];
  for (const r of records || []) {
    recordIds.push(r.id as string);
    const e = normEmail(r.email as string | null);
    if (e.includes('@')) out.set(e, (r.name as string) || e);
  }

  if (recordIds.length) {
    const { data: txs } = await supabaseServer.from('transactions').select('id').in('agent_id', recordIds).limit(1000);
    const txIds = (txs || []).map((t) => t.id as string);
    if (txIds.length) {
      const { data: links } = await supabaseServer.from('transaction_agents').select('agent_user_id').in('transaction_id', txIds).limit(500);
      const userIds = [...new Set((links || []).map((l) => l.agent_user_id as string))].slice(0, 100);
      await Promise.all(
        userIds.map(async (uid) => {
          const { data } = await supabaseServer.auth.admin.getUserById(uid);
          const e = normEmail(data.user?.email);
          if (e && !out.has(e)) out.set(e, (data.user?.user_metadata?.full_name as string | undefined)?.trim() || e);
        })
      );
    }
  }

  const { data: past } = await supabaseServer.from('direct_messages').select('agent_email').eq('tc_user_id', tcUserId).limit(500);
  for (const p of past || []) {
    const e = p.agent_email as string;
    if (!out.has(e)) out.set(e, e);
  }
  return out;
}
