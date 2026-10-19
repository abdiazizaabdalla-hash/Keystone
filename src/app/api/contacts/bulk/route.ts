import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanTags, MAX_TAGS_PER_CONTACT, type ContactRow } from '@/lib/contactsCrm';

// One action applied to many selected contacts:
// add_tag / remove_tag ({ tag }), subscribe / unsubscribe (newsletter flag), delete.
const ACTIONS = ['add_tag', 'remove_tag', 'subscribe', 'unsubscribe', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    const body = await request.json().catch(() => ({}));
    const action = body.action as Action;
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : [];
    if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    if (ids.length === 0 || ids.length > 1000) return NextResponse.json({ error: 'Select between 1 and 1000 contacts' }, { status: 400 });

    if (action === 'delete') {
      const { error } = await supabaseServer.from('contacts').delete().in('id', ids).eq('tc_user_id', user.id);
      if (error) throw error;
      return NextResponse.json({ success: true, count: ids.length });
    }

    if (action === 'subscribe' || action === 'unsubscribe') {
      let q = supabaseServer
        .from('contacts')
        .update({ newsletter: action === 'subscribe', updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('tc_user_id', user.id);
      // Only people with an email address can be on a newsletter.
      if (action === 'subscribe') q = q.not('email', 'is', null);
      const { error } = await q;
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // Tag changes: read, adjust each contact's tag list, write back.
    const tag = cleanTags([body.tag])[0];
    if (!tag) return NextResponse.json({ error: 'Enter a tag' }, { status: 400 });
    const { data: rows, error: readError } = await supabaseServer
      .from('contacts')
      .select('id, tags')
      .in('id', ids)
      .eq('tc_user_id', user.id);
    if (readError) throw readError;

    for (const row of (rows || []) as Pick<ContactRow, 'id' | 'tags'>[]) {
      const current = row.tags || [];
      const next =
        action === 'add_tag'
          ? cleanTags([...current, tag]).slice(0, MAX_TAGS_PER_CONTACT)
          : current.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      if (next.length === current.length && next.every((t, i) => t === current[i])) continue;
      const { error } = await supabaseServer
        .from('contacts')
        .update({ tags: next, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('tc_user_id', user.id);
      if (error) throw error;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error applying bulk contact action:', error);
    return NextResponse.json({ error: 'Failed to update contacts' }, { status: 500 });
  }
}
