import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { autoAddContact } from '@/lib/contactsAuto';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { queueListingCalendarSync } from '@/lib/calendarSync';
import { CHILD_TABLE, MAX_PER_LISTING, cleanChild, isChildKind } from '@/lib/listingChildren';

// POST /api/listings/:id/(tasks|offers|contacts|dates): add one.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const { id, kind } = await params;
    if (!isChildKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const cleaned = cleanChild(kind, body, listing as { planned_list_date: string | null }, false);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const table = CHILD_TABLE[kind];
    const { count } = await supabaseServer.from(table).select('id', { count: 'exact', head: true }).eq('listing_id', id);
    if ((count ?? 0) >= MAX_PER_LISTING) return NextResponse.json({ error: `A listing can hold up to ${MAX_PER_LISTING} of these` }, { status: 400 });

    const extra: Record<string, unknown> = {};
    if (kind === 'tasks' || kind === 'contacts') extra[kind === 'tasks' ? 'sort_order' : 'position'] = count ?? 0;

    const { data, error } = await supabaseServer.from(table).insert({ ...cleaned.value, ...extra, listing_id: id }).select('*').single();
    if (error) throw error;
    if (kind === 'contacts') {
      const owner = (listing as { tc_user_id?: string }).tc_user_id;
      const c = data as { name?: string | null; email?: string | null; phone?: string | null; role?: string | null };
      if (owner) await autoAddContact(owner, c);
    }
    const row = data as Record<string, unknown>;
    if (kind === 'offers') {
      const price = row.offer_price ? ` for $${Number(row.offer_price).toLocaleString('en-US')}` : '';
      await logListingActivity(id, user, `Offer received${row.buyer_name ? ` from ${row.buyer_name}` : ''}${price}`);
    } else if (kind === 'showings') {
      const label = row.kind === 'open_house' ? 'Open house' : row.kind === 'broker_tour' ? 'Broker tour' : 'Showing';
      await logListingActivity(id, user, `${label} logged for ${row.showing_date}${row.visitor ? ` (${row.visitor})` : ''}`);
    } else if (kind === 'dates') {
      await logListingActivity(id, user, `Date added: ${row.label} on ${row.due_date}`);
    }
    if (kind === 'tasks' || kind === 'dates') queueListingCalendarSync(id);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error adding listing item:', error);
    return NextResponse.json({ error: 'Failed to add' }, { status: 500 });
  }
}
