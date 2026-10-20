import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireAgentListing } from '@/lib/agentListings';
import { logListingActivity } from '@/lib/listings';

// DELETE: the agent removes a person THEY added. People the coordinator added can only be changed by the coordinator.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  try {
    const { id, contactId } = await params;
    const { user } = await requireAgentListing(request, id);
    const { data: contact } = await supabaseServer.from('listing_contacts').select('id, name, email, added_by_agent').eq('id', contactId).eq('listing_id', id).maybeSingle();
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (contact.added_by_agent !== true) return NextResponse.json({ error: 'Only your coordinator can remove this person' }, { status: 403 });
    const { error } = await supabaseServer.from('listing_contacts').delete().eq('id', contactId).eq('listing_id', id);
    if (error) throw error;
    await logListingActivity(id, user, `The agent removed ${contact.name || contact.email || 'a person'} from the people on the listing`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error removing a listing contact as the agent:', error);
    return NextResponse.json({ error: 'Failed to remove this person' }, { status: 500 });
  }
}
