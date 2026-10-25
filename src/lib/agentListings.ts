import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';

// Which listings an agent-portal user may see. There is no invite step for listings: a listing is
// visible to the person whose login email matches the email on the listing's agent record, as long
// as the TC left "Share with the agent" on. The TC controls what exists; the agent only ever gets
// a read-only view.

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function getAgentListingRowsDetailed(email: string | null | undefined): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const e = (email || '').trim().toLowerCase();
  if (!e) return { rows: [], error: null };
  const { data: agents } = await supabaseServer.from('agents').select('id, tc_user_id').ilike('email', escapeLike(e)).limit(200);
  if (!agents || agents.length === 0) return { rows: [], error: null };
  const { data: listings, error } = await supabaseServer
    .from('listings')
    .select('*')
    .in('agent_id', agents.map((a) => a.id as string))
    .eq('share_with_agent', true)
    .neq('status', 'withdrawn')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    // add-listings.sql / add-listing-extras.sql not run yet
    console.error('getAgentListingRows failed (ignored):', error.message);
    return { rows: [], error: error.message };
  }
  return { rows: (listings || []) as Record<string, unknown>[], error: null };
}

export async function getAgentListingRows(email: string | null | undefined) {
  return (await getAgentListingRowsDetailed(email)).rows as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** An agent is signed in and this listing is one that is shared with them. Same lookup as the list, so the rules can't drift. */
export async function requireAgentListing(request: NextRequest, listingId: string) {
  const { user } = await getUserFromRequest(request);
  if (!isAgentUser(user)) throw new AuthError('This endpoint is for agent accounts only', 403);
  const listing = (await getAgentListingRows(user.email)).find((l) => l.id === listingId);
  if (!listing) throw new AuthError('Listing not found', 404);
  return { user, listing };
}
