import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { requireListingAccess } from '@/lib/listings';
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
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error adding listing item:', error);
    return NextResponse.json({ error: 'Failed to add' }, { status: 500 });
  }
}
