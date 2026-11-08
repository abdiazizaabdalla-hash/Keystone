import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { agentLabels, assertBrokerageOwner, canOverseeListing } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';

const BUCKET = 'transaction-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Everything the listing page needs to show an agent's listing to the brokerage owner, in the shapes the agent's own page
// reads them in (the same as GET /api/listings/[id] plus the documents with links). Read-only; 404 unless the caller
// oversees the listing's owner. The conversations with the seller and the coordinator are left out on purpose.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    await assertBrokerageOwner(user);
    if (!(await canOverseeListing(user.id, id))) throw new AuthError('Not found', 404);

    const { data: listing, error } = await supabaseServer.from('listings').select('*').eq('id', id).single();
    if (error) throw error;
    const [tasks, offers, contacts, dates, showings, priceChanges, docs, labels] = await Promise.all([
      supabaseServer.from('listing_tasks').select('*').eq('listing_id', id).order('sort_order', { ascending: true }),
      supabaseServer.from('listing_offers').select('*').eq('listing_id', id).order('created_at', { ascending: false }),
      supabaseServer.from('listing_contacts').select('*').eq('listing_id', id).order('position', { ascending: true }),
      supabaseServer.from('listing_dates').select('*').eq('listing_id', id).order('due_date', { ascending: true }),
      supabaseServer.from('listing_showings').select('*').eq('listing_id', id).order('showing_date', { ascending: false }),
      supabaseServer.from('listing_price_changes').select('*').eq('listing_id', id).order('changed_on', { ascending: true }).order('created_at', { ascending: true }),
      supabaseServer.from('listing_documents').select('*').eq('listing_id', id).order('created_at', { ascending: false }).limit(200),
      agentLabels([listing.tc_user_id as string]),
    ]);
    const documents = await Promise.all(
      (docs.data ?? []).map(async (d) => {
        const { data: signed } = await supabaseServer.storage.from(BUCKET).createSignedUrl(d.storage_path as string, SIGNED_URL_TTL_SECONDS);
        return { ...d, url: signed?.signedUrl ?? null };
      })
    );
    const label = labels.get(listing.tc_user_id as string) ?? null;
    return NextResponse.json({
      listing,
      shared: false,
      coordinated: false,
      coordinator: null,
      invitedCoordinator: null,
      assignees: [],
      // The listing's agent is the one who owns it, so the header names them.
      agent: label ? { id: listing.tc_user_id, name: label.name, email: label.email } : null,
      tasks: tasks.data ?? [],
      offers: offers.data ?? [],
      contacts: contacts.data ?? [],
      dates: dates.data ?? [],
      showings: showings.data ?? [],
      priceChanges: priceChanges.data ?? [],
      activity: [],
      documents,
    });
  } catch (error) {
    return oversightError(error, 'load that listing');
  }
}
