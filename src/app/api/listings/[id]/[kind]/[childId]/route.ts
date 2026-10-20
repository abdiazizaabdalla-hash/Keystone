import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { requireListingAccess } from '@/lib/listings';
import { CHILD_TABLE, cleanChild, isChildKind } from '@/lib/listingChildren';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing item:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string; childId: string }> }) {
  try {
    const { id, kind, childId } = await params;
    if (!isChildKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const cleaned = cleanChild(kind, body, listing as { planned_list_date: string | null }, true);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });
    if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    const { data, error } = await supabaseServer
      .from(CHILD_TABLE[kind])
      .update(cleaned.value)
      .eq('id', childId)
      .eq('listing_id', id) // the child must belong to THIS listing
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return fail(error, 'update');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string; childId: string }> }) {
  try {
    const { id, kind, childId } = await params;
    if (!isChildKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const { error } = await supabaseServer.from(CHILD_TABLE[kind]).delete().eq('id', childId).eq('listing_id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'delete');
  }
}
