import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getAgentListingRows } from '@/lib/agentListings';

// GET: one listing shared with this agent: details, key dates, offers, showings and price history. Read-only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });

    // Same lookup as the list, so the sharing rules can't drift apart.
    const listing = (await getAgentListingRows(user.email)).find((l) => l.id === id);
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    const [dates, offers, showings, priceChanges, tc] = await Promise.all([
      supabaseServer.from('listing_dates').select('id, label, due_date').eq('listing_id', id).order('due_date', { ascending: true }),
      supabaseServer.from('listing_offers').select('*').eq('listing_id', id).order('created_at', { ascending: false }),
      supabaseServer.from('listing_showings').select('id, showing_date, kind, visitor, interest, feedback').eq('listing_id', id).order('showing_date', { ascending: false }),
      supabaseServer.from('listing_price_changes').select('id, old_price, new_price, changed_on, note').eq('listing_id', id).order('changed_on', { ascending: true }),
      supabaseServer.auth.admin.getUserById(listing.tc_user_id as string),
    ]);

    return NextResponse.json({
      listing: {
        id: listing.id,
        propertyAddress: listing.property_address,
        status: listing.status,
        listPrice: listing.list_price,
        plannedListDate: listing.planned_list_date,
        expirationDate: listing.expiration_date,
        mlsNumber: listing.mls_number,
        mlsUrl: listing.mls_url,
        sellerName: listing.seller_name,
        convertedTransactionId: listing.converted_transaction_id,
      },
      tcLabel: (tc.data.user?.user_metadata?.full_name as string | undefined) || tc.data.user?.email || 'Transaction coordinator',
      dates: dates.data || [],
      offers: (offers.data || []).map((o) => ({
        id: o.id,
        buyerName: o.buyer_name,
        buyerAgent: o.buyer_agent,
        offerPrice: o.offer_price,
        status: o.status,
        receivedOn: o.received_on,
        financing: o.financing ?? null,
        earnestMoney: o.earnest_money ?? null,
        optionDays: o.option_days ?? null,
        closingDate: o.closing_date ?? null,
        sellerConcessions: o.seller_concessions ?? null,
        offerExpires: o.offer_expires_at ?? null,
        possession: o.possession ?? null,
        contingencies: o.contingencies ?? null,
        terms: o.terms,
      })),
      showings: showings.data || [],
      priceChanges: priceChanges.data || [],
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error fetching agent listing:', error);
    return NextResponse.json({ error: 'Failed to fetch listing' }, { status: 500 });
  }
}
