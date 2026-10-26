import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { UUID_RE } from '@/lib/contactsCrm';

// How long after a CSV import it can be undone. The browser shows a 2 minute countdown; this check is
// the real limit, with a little slack for the request itself.
const UNDO_WINDOW_MS = 2 * 60 * 1000;
const SLACK_MS = 15 * 1000;
// A contact edited after the import is left alone so no changes are lost.
const EDIT_TOLERANCE_MS = 5 * 1000;

// Undo the contacts a CSV import just added. Only contacts that are this TC's own, came from an import,
// were created within the last 2 minutes, have not been edited and are not shared with a team are removed.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : [];
    if (ids.length === 0 || ids.length > 5000) return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
    if (ids.some((x) => !UUID_RE.test(x))) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const now = Date.now();
    const removable: string[] = [];
    let kept = 0;
    let expired = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabaseServer
        .from('contacts')
        .select('id, source, created_at, updated_at, team_id')
        .in('id', ids.slice(i, i + 200))
        .eq('tc_user_id', user.id);
      if (error) throw error;
      for (const c of data || []) {
        const created = Date.parse(String(c.created_at));
        if (c.source !== 'import' || Number.isNaN(created) || now - created > UNDO_WINDOW_MS + SLACK_MS) {
          expired += 1;
          continue;
        }
        const updated = Date.parse(String(c.updated_at));
        if (c.team_id || (!Number.isNaN(updated) && updated - created > EDIT_TOLERANCE_MS)) {
          kept += 1;
          continue;
        }
        removable.push(c.id as string);
      }
    }

    let removed = 0;
    for (let i = 0; i < removable.length; i += 200) {
      const chunk = removable.slice(i, i + 200);
      const { error } = await supabaseServer.from('contacts').delete().in('id', chunk).eq('tc_user_id', user.id);
      if (error) throw error;
      removed += chunk.length;
    }
    return NextResponse.json({ removed, kept, expired });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error undoing contacts import:', error);
    return NextResponse.json({ error: 'Failed to undo the import' }, { status: 500 });
  }
}
