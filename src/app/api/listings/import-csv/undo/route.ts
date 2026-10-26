import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { logAudit } from '@/lib/audit';
import { UUID_RE } from '@/lib/contactsCrm';

// Same 2 minute window as the contacts import: the browser shows the countdown, this is the real limit.
const UNDO_WINDOW_MS = 2 * 60 * 1000;
const SLACK_MS = 15 * 1000;
const EDIT_TOLERANCE_MS = 5 * 1000;

// Undo the listings a CSV import just added. Only listings that are this TC's own, were created within the
// last 2 minutes, have not been edited and have no offers or documents yet are removed (their checklist and
// contacts go with them). Anything the TC has already started working on is left alone.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) throw new AuthError('Not available', 403);

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : [];
    if (ids.length === 0 || ids.length > 500) return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
    if (ids.some((x) => !UUID_RE.test(x))) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const now = Date.now();
    const { data, error } = await supabaseServer.from('listings').select('id, created_at, updated_at, converted_transaction_id').in('id', ids).eq('tc_user_id', user.id);
    if (error) throw error;

    const removable: string[] = [];
    let kept = 0;
    let expired = 0;
    for (const l of data || []) {
      const created = Date.parse(String(l.created_at));
      if (Number.isNaN(created) || now - created > UNDO_WINDOW_MS + SLACK_MS) {
        expired += 1;
        continue;
      }
      const updated = Date.parse(String(l.updated_at));
      if (l.converted_transaction_id || (!Number.isNaN(updated) && updated - created > EDIT_TOLERANCE_MS)) {
        kept += 1;
        continue;
      }
      removable.push(l.id as string);
    }

    // Offers or documents added in the meantime also mean "keep it".
    let safe = removable;
    if (removable.length) {
      const [{ data: offers }, { data: docs }] = await Promise.all([
        supabaseServer.from('listing_offers').select('listing_id').in('listing_id', removable).limit(5000),
        supabaseServer.from('listing_documents').select('listing_id').in('listing_id', removable).limit(5000),
      ]);
      const busy = new Set([...(offers || []), ...(docs || [])].map((r) => String(r.listing_id)));
      kept += removable.filter((id) => busy.has(id)).length;
      safe = removable.filter((id) => !busy.has(id));
    }

    if (safe.length) {
      const { error: delError } = await supabaseServer.from('listings').delete().in('id', safe).eq('tc_user_id', user.id);
      if (delError) throw delError;
      await logAudit(request, user, 'listing.import_undo', { entityType: 'listing', metadata: { removed: safe.length } });
    }
    return NextResponse.json({ removed: safe.length, kept, expired });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error undoing listings import:', error);
    return NextResponse.json({ error: 'Failed to undo the import' }, { status: 500 });
  }
}
