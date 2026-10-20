import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireAgentListing } from '@/lib/agentListings';
import { checkRateLimit } from '@/lib/rateLimit';
import { cleanText, logListingActivity } from '@/lib/listings';

const MAX_CONTACTS = 60;

// POST { role, name, email, phone }: the agent adds a person to the listing (a lender, a stager, a co-owner...).
// It shows to the coordinator on the listing and is marked as added by the agent. Nothing is sent to the person.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireAgentListing(request, id);
    if (!(await checkRateLimit(`agent-listing-contact:${user.id}`, 40, 60 * 60))) {
      return NextResponse.json({ error: 'You have added a lot of people. Try again a bit later.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const role = cleanText(body.role, 60);
    const name = cleanText(body.name, 200);
    const email = cleanText(body.email, 254)?.toLowerCase() ?? null;
    const phone = cleanText(body.phone, 40);
    if (!name && !email && !phone) return NextResponse.json({ error: 'Add a name, email or phone number' }, { status: 400 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'That email address does not look right' }, { status: 400 });

    const { count } = await supabaseServer.from('listing_contacts').select('id', { count: 'exact', head: true }).eq('listing_id', id);
    if ((count ?? 0) >= MAX_CONTACTS) return NextResponse.json({ error: `A listing can hold up to ${MAX_CONTACTS} people` }, { status: 400 });

    const row = { listing_id: id, role, name, email, phone, position: count ?? 0 };
    let { data, error } = await supabaseServer.from('listing_contacts').insert({ ...row, added_by_agent: true }).select('*').single();
    if (error) {
      // add-listing-agent-access.sql not run yet: save without the "added by agent" mark.
      ({ data, error } = await supabaseServer.from('listing_contacts').insert(row).select('*').single());
    }
    if (error || !data) throw error || new Error('insert failed');

    const label = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || 'The agent';
    await logListingActivity(id, user, `${label} added ${name || email || phone} to the people on the listing`);
    return NextResponse.json(
      { id: data.id, role: data.role ?? null, name: data.name ?? null, email: data.email ?? null, phone: data.phone ?? null, addedByAgent: data.added_by_agent === true },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error adding a listing contact as the agent:', error);
    return NextResponse.json({ error: 'Failed to add this person' }, { status: 500 });
  }
}
