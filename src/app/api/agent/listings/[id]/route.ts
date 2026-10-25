import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireAgentListing } from '@/lib/agentListings';

// GET: one listing shared with this agent: details, key dates, offers, showings and price history. Read-only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { listing } = await requireAgentListing(request, id);

    const [dates, offers, showings, priceChanges, tc, tasks, contacts, documents] = await Promise.all([
      supabaseServer.from('listing_dates').select('id, label, due_date').eq('listing_id', id).order('due_date', { ascending: true }),
      supabaseServer.from('listing_offers').select('*').eq('listing_id', id).order('created_at', { ascending: false }),
      supabaseServer.from('listing_showings').select('id, showing_date, kind, visitor, interest, feedback').eq('listing_id', id).order('showing_date', { ascending: false }),
      supabaseServer.from('listing_price_changes').select('id, old_price, new_price, changed_on, note').eq('listing_id', id).order('changed_on', { ascending: true }),
      supabaseServer.auth.admin.getUserById(listing.tc_user_id as string),
      supabaseServer.from('listing_tasks').select('id, name, due_date, completed').eq('listing_id', id).order('sort_order', { ascending: true }),
      supabaseServer.from('listing_contacts').select('*').eq('listing_id', id).order('position', { ascending: true }),
      supabaseServer.from('listing_documents').select('id, file_name, document_type, content_type, file_size, is_signed, created_at').eq('listing_id', id).order('created_at', { ascending: false }),
    ]);

    const { data: agentRow } = listing.agent_id
      ? await supabaseServer.from('agents').select('name').eq('id', listing.agent_id as string).maybeSingle()
      : { data: null };

    return NextResponse.json({
      agentName: (agentRow?.name as string | undefined) || null,
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
        listedOn: listing.listed_on ?? null,
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
      // The coordinator's working checklist, read-only. Their private notes are never sent.
      checklist: (tasks.data || []).map((t) => ({ id: t.id, name: t.name, dueDate: t.due_date, completed: t.completed === true })),
      contacts: (contacts.data || []).map((c) => ({
        id: c.id,
        role: c.role ?? null,
        name: c.name ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        addedByAgent: c.added_by_agent === true,
      })),
      documents: (documents.data || []).map((d) => ({
        id: d.id,
        fileName: d.file_name,
        documentType: d.document_type,
        contentType: d.content_type ?? null,
        fileSize: d.file_size ?? null,
        isSigned: d.is_signed === true,
        createdAt: d.created_at,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error fetching agent listing:', error);
    return NextResponse.json({ error: 'Failed to fetch listing' }, { status: 500 });
  }
}
