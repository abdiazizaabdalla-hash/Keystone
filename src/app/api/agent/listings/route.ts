import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getAgentListingRows } from '@/lib/agentListings';

// GET: the listings shared with this agent (read-only). Deliberately small: no checklist, notes,
// documents or history, which are the TC's working files.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });

    const listings = await getAgentListingRows(user.email);
    if (listings.length === 0) return NextResponse.json([]);

    const ids = listings.map((l) => l.id as string);
    const [{ data: offers }, { data: showings }] = await Promise.all([
      supabaseServer.from('listing_offers').select('listing_id, status').in('listing_id', ids),
      supabaseServer.from('listing_showings').select('listing_id').in('listing_id', ids),
    ]);
    const openOffers = new Map<string, number>();
    for (const o of offers || []) {
      if (o.status === 'received' || o.status === 'countered') openOffers.set(o.listing_id as string, (openOffers.get(o.listing_id as string) || 0) + 1);
    }
    const showingCount = new Map<string, number>();
    for (const sh of showings || []) showingCount.set(sh.listing_id as string, (showingCount.get(sh.listing_id as string) || 0) + 1);

    const tcLabels = new Map<string, string>();
    await Promise.all(
      [...new Set(listings.map((l) => l.tc_user_id as string))].map(async (tcId) => {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        tcLabels.set(tcId, (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator');
      })
    );

    return NextResponse.json(
      listings.map((l) => ({
        id: l.id,
        propertyAddress: l.property_address,
        status: l.status,
        listPrice: l.list_price,
        plannedListDate: l.planned_list_date,
        expirationDate: l.expiration_date,
        openOffers: openOffers.get(l.id as string) || 0,
        showings: showingCount.get(l.id as string) || 0,
        tcLabel: tcLabels.get(l.tc_user_id as string) || 'Transaction coordinator',
      }))
    );
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error fetching agent listings:', error);
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 });
  }
}
