import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { queueListingCalendarSync } from '@/lib/calendarSync';

// POST /api/listings/:id/checklist
//   { action: 'complete_all' }          mark every open step done
//   { action: 'reopen_all' }            mark every step not done
//   { action: 'reorder', ids: [...] }   put the steps in this order (must be exactly this listing's steps)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'complete_all') {
      const { data, error } = await supabaseServer
        .from('listing_tasks')
        .update({ completed: true, completed_at: new Date().toISOString() })
        .eq('listing_id', id)
        .eq('completed', false)
        .select('id');
      if (error) throw error;
      const n = data?.length ?? 0;
      if (n > 0) await logListingActivity(id, user, `Marked ${n} checklist step${n === 1 ? '' : 's'} done`);
      queueListingCalendarSync(id);
      return NextResponse.json({ changed: n });
    }

    if (action === 'reopen_all') {
      const { data, error } = await supabaseServer
        .from('listing_tasks')
        .update({ completed: false, completed_at: null })
        .eq('listing_id', id)
        .eq('completed', true)
        .select('id');
      if (error) throw error;
      const n = data?.length ?? 0;
      if (n > 0) await logListingActivity(id, user, `Reopened ${n} checklist step${n === 1 ? '' : 's'}`);
      queueListingCalendarSync(id);
      return NextResponse.json({ changed: n });
    }

    if (action === 'reorder') {
      const ids: unknown = body?.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || ids.some((x) => typeof x !== 'string')) {
        return NextResponse.json({ error: 'Send the full list of step ids' }, { status: 400 });
      }
      const { data: existing, error: loadError } = await supabaseServer.from('listing_tasks').select('id').eq('listing_id', id);
      if (loadError) throw loadError;
      const have = new Set((existing || []).map((r) => r.id as string));
      const want = new Set(ids as string[]);
      // Exactly this listing's steps: nothing missing, nothing from another listing, no repeats.
      if (want.size !== ids.length || want.size !== have.size || [...want].some((x) => !have.has(x))) {
        return NextResponse.json({ error: 'The checklist changed. Reload the page and try again.' }, { status: 409 });
      }
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabaseServer.from('listing_tasks').update({ sort_order: i }).eq('id', ids[i] as string).eq('listing_id', id);
        if (error) throw error;
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error updating listing checklist:', error);
    return NextResponse.json({ error: 'Failed to update the checklist' }, { status: 500 });
  }
}
