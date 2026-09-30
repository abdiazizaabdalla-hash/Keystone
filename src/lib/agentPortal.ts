import { supabaseServer } from './supabase';
import { AuthError } from './auth';

// Shape getUserFromRequest's `user` already has -- kept minimal here so
// this file doesn't need to import the full Supabase User type.
export interface MinimalUser {
  id: string;
  email?: string;
  user_metadata?: { role?: string; [key: string]: unknown };
}

// Agents are real Supabase Auth users, distinguished from TCs purely by
// user_metadata.role (set at creation -- see POST /api/agent-invites and
// src/app/agent/accept/page.tsx). There's no separate "agents" auth
// table; the existing `agents` table stays what it's always been -- a
// TC's own commission/contact record for someone, not a login.
export function isAgentUser(user: MinimalUser): boolean {
  return user.user_metadata?.role === 'agent';
}

// Confirms `userId` (an agent) has accepted access to `transactionId`.
// Every agent-facing route must call this before returning or accepting
// anything scoped to a transaction -- it's the actual authorization
// check; the RLS policies in add-agent-portal.sql are a defense-in-depth
// backstop only, since the app always queries with the service-role
// client (see src/lib/auth.ts).
export async function assertAgentOnTransaction(transactionId: string, userId: string): Promise<void> {
  const { data, error } = await supabaseServer
    .from('transaction_agents')
    .select('transaction_id')
    .eq('transaction_id', transactionId)
    .eq('agent_user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new AuthError('You do not have access to this transaction', 403);
  }
}

// Every transaction id this agent has been added to, across every TC
// that's invited them -- this is the whole of what makes their portal
// "one login, the union of what I've been added to" (see
// GET /api/agent/transactions).
export async function getAgentTransactionIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from('transaction_agents')
    .select('transaction_id')
    .eq('agent_user_id', userId);
  if (error) throw error;
  return (data || []).map((row) => row.transaction_id as string);
}
