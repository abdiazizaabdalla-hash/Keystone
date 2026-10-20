import { supabaseServer } from '@/lib/supabase';

// Which listings an agent-portal user may see. There is no invite step for listings: a listing is
// visible to the person whose login email matches the email on the listing's agent record, as long
// as the TC left "Share with the agent" on. The TC controls what exists; the agent only ever gets
// a read-only view.

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function getAgentListingRows(email: string | null | undefined) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return [];
  const { data: agents } = await supabaseServer.from('agents').select('id, tc_user_id').ilike('email', escapeLike(e)).limit(200);
  if (!agents || agents.length === 0) return [];
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
    return [];
  }
  return listings || [];
}
