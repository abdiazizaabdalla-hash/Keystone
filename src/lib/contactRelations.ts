import { supabaseServer } from '@/lib/supabase';
import { getVisibleTcUserIds } from '@/lib/team';
import { escapeLike, type ContactRow } from '@/lib/contactsCrm';

// Everything a contact is connected to: the deals and listings they are on, found by their
// agent profile (the linked agent, or an agent with the same email) and by email on the deal
// and listing contact lists. Read-only; never returns another TC's data.

export interface RelatedTransaction {
  id: string;
  property_address: string;
  file_number: string | null;
  status: string | null;
  closing_date: string | null;
  created_at: string;
  as: string;
}

export interface RelatedListing {
  id: string;
  property_address: string;
  status: string | null;
  list_price: number | null;
  created_at: string;
  as: string;
}

export interface ContactRelations {
  transactions: RelatedTransaction[];
  listings: RelatedListing[];
  agentIds: string[];
  stats: {
    transactionsTotal: number;
    transactionsActive: number;
    transactionsClosed: number;
    listingsTotal: number;
    listingsActive: number;
    lastClosingDate: string | null;
  };
}

const OPEN_LISTING = new Set(['preparing', 'active', 'under_offer']);

export async function loadContactRelations(userId: string, contact: Pick<ContactRow, 'email' | 'agent_id'>): Promise<ContactRelations> {
  const visibleIds = await getVisibleTcUserIds(userId);
  const email = (contact.email || '').trim().toLowerCase();

  // Agent profiles that are this person: the linked one, plus any with the same email.
  const { data: agentRows } = await supabaseServer.from('agents').select('id, email').in('tc_user_id', visibleIds).limit(2000);
  const agentIds = (agentRows || [])
    .filter((a) => a.id === contact.agent_id || (email && (a.email || '').trim().toLowerCase() === email))
    .map((a) => a.id as string);

  const txs = new Map<string, RelatedTransaction>();
  const lists = new Map<string, RelatedListing>();
  const txCols = 'id, property_address, file_number, status, closing_date, created_at';
  const listCols = 'id, property_address, status, list_price, created_at';

  if (agentIds.length > 0) {
    const [{ data: t }, { data: l }] = await Promise.all([
      supabaseServer.from('transactions').select(txCols).in('agent_id', agentIds).in('tc_user_id', visibleIds).order('created_at', { ascending: false }).limit(500),
      supabaseServer.from('listings').select(listCols).in('agent_id', agentIds).in('tc_user_id', visibleIds).order('created_at', { ascending: false }).limit(500),
    ]);
    for (const r of t || []) txs.set(r.id as string, { ...(r as Omit<RelatedTransaction, 'as'>), as: 'Agent' });
    for (const r of l || []) lists.set(r.id as string, { ...(r as Omit<RelatedListing, 'as'>), as: 'Agent' });
  }

  if (email) {
    const pattern = escapeLike(email);
    const [{ data: tParts }, { data: lParts }, { data: sellers }] = await Promise.all([
      supabaseServer.from('transaction_contacts').select('transaction_id, role').ilike('email', pattern).limit(1000),
      supabaseServer.from('listing_contacts').select('listing_id, role').ilike('email', pattern).limit(1000),
      supabaseServer.from('listings').select(listCols).in('tc_user_id', visibleIds).ilike('seller_email', pattern).limit(200),
    ]);
    const roleByTx = new Map((tParts || []).map((p) => [p.transaction_id as string, (p.role as string) || 'Contact']));
    const roleByListing = new Map((lParts || []).map((p) => [p.listing_id as string, (p.role as string) || 'Contact']));
    const txIds = [...roleByTx.keys()].filter((id) => !txs.has(id));
    const listIds = [...roleByListing.keys()].filter((id) => !lists.has(id));
    for (let i = 0; i < txIds.length; i += 200) {
      const { data } = await supabaseServer.from('transactions').select(txCols).in('id', txIds.slice(i, i + 200)).in('tc_user_id', visibleIds);
      for (const r of data || []) txs.set(r.id as string, { ...(r as Omit<RelatedTransaction, 'as'>), as: roleByTx.get(r.id as string) || 'Contact' });
    }
    for (let i = 0; i < listIds.length; i += 200) {
      const { data } = await supabaseServer.from('listings').select(listCols).in('id', listIds.slice(i, i + 200)).in('tc_user_id', visibleIds);
      for (const r of data || []) lists.set(r.id as string, { ...(r as Omit<RelatedListing, 'as'>), as: roleByListing.get(r.id as string) || 'Contact' });
    }
    for (const r of sellers || []) if (!lists.has(r.id as string)) lists.set(r.id as string, { ...(r as Omit<RelatedListing, 'as'>), as: 'Seller' });
  }

  const transactions = [...txs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  const listings = [...lists.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  const closed = transactions.filter((t) => t.status === 'Closed');
  const lastClosingDate = closed.map((t) => t.closing_date).filter((d): d is string => !!d).sort().pop() || null;

  return {
    transactions,
    listings,
    agentIds,
    stats: {
      transactionsTotal: transactions.length,
      transactionsActive: transactions.length - closed.length,
      transactionsClosed: closed.length,
      listingsTotal: listings.length,
      listingsActive: listings.filter((l) => OPEN_LISTING.has(l.status || '')).length,
      lastClosingDate,
    },
  };
}
