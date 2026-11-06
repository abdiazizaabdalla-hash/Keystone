import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { agentLabels, assertBrokerageOwner, canOverseeListing, listingHealth } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';

// One listing of an agent in this brokerage, read-only: the listing, its checklist, the names of its documents and how many
// offers there are. Seller contact details, offer terms and buyers, comments and files stay in the agent's workspace.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    await assertBrokerageOwner(user);
    if (!(await canOverseeListing(user.id, id))) throw new AuthError('Not found', 404);

    const { data: listing, error } = await supabaseServer
      .from('listings')
      .select('id, tc_user_id, property_address, status, list_price, planned_list_date, listed_on, expiration_date, mls_number, updated_at, created_at')
      .eq('id', id)
      .single();
    if (error) throw error;
    const [{ data: tasks }, { data: documents }, { data: offers }, labels] = await Promise.all([
      supabaseServer.from('listing_tasks').select('id, name, completed, due_date, sort_order').eq('listing_id', id).order('sort_order', { ascending: true }),
      supabaseServer.from('listing_documents').select('id, file_name, document_type, created_at').eq('listing_id', id).order('created_at', { ascending: false }).limit(100),
      supabaseServer.from('listing_offers').select('status').eq('listing_id', id),
      agentLabels([listing.tc_user_id as string]),
    ]);
    const offerCounts = { total: (offers ?? []).length, open: (offers ?? []).filter((o) => o.status === 'received' || o.status === 'countered').length };
    return NextResponse.json({
      listing,
      agent: labels.get(listing.tc_user_id as string) ?? null,
      tasks: tasks ?? [],
      documents: documents ?? [],
      offers: offerCounts,
      health: listingHealth(listing, tasks ?? [], todayIso()),
    });
  } catch (error) {
    return oversightError(error, 'load that listing');
  }
}
