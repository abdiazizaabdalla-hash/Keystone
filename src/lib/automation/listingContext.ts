import { supabaseServer } from '../supabase';
import type { DealPerson } from '../templateContext';
import { categoryOfRole } from './library';

// The people on a listing, shaped like the people on a deal so the same recipient rules (roles, allowlist) apply. Only people
// with an email address are ever reachable; the listing's own agent and its saved contacts are the whole list.

export interface ListingParties {
  address: string;
  sellerName: string;
  people: DealPerson[];
}

export async function loadListingParties(listingId: string): Promise<ListingParties | null> {
  const { data: l } = await supabaseServer.from('listings').select('property_address, seller_name, agent_id').eq('id', listingId).maybeSingle();
  if (!l) return null;
  const [{ data: contacts }, agentRes] = await Promise.all([
    supabaseServer.from('listing_contacts').select('role, name, email').eq('listing_id', listingId).order('position', { ascending: true }).limit(100),
    l.agent_id ? supabaseServer.from('agents').select('name, email').eq('id', l.agent_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const people: DealPerson[] = [];
  const agent = agentRes.data as { name: string | null; email: string | null } | null;
  if (agent?.email) people.push({ name: agent.name ?? 'Agent', email: agent.email, role: 'Agent', category: 'Agent' });
  for (const c of contacts ?? []) {
    if (!c.email) continue;
    people.push({ name: (c.name as string | null) ?? '', email: c.email as string, role: (c.role as string | null) ?? '', category: categoryOfRole(c.role as string | null) });
  }
  return { address: l.property_address as string, sellerName: (l.seller_name as string | null) ?? '', people };
}
