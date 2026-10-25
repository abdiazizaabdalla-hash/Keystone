import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanTags, MAX_TAGS_PER_CONTACT, UUID_RE, type ContactRow } from '@/lib/contactsCrm';
import { canAccessContact, getUserTeamId } from '@/lib/contactGuard';
import { shareContactsToTeam } from '@/lib/contactSync';

// One action applied to many selected contacts:
// add_tag / remove_tag ({ tag }), subscribe / unsubscribe (newsletter flag), delete,
// share_team / unshare_team. Tags work on your contacts and ones your team shared; the rest only
// on your own. Deleting a contact a teammate shared only removes it from the team list.
const ACTIONS = ['add_tag', 'remove_tag', 'subscribe', 'unsubscribe', 'delete', 'share_team', 'unshare_team'] as const;
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

    if (ids.some((x) => !UUID_RE.test(x))) return NextResponse.json({ error: 'Invalid selection' }, { status: 400 });

    // Which of the selected contacts this TC may touch: their own, or a teammate's shared with the team.
    const teamId = await getUserTeamId(user.id);
    const found: { id: string; tc_user_id: string; team_id: string | null; tags: string[] }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabaseServer.from('contacts').select('id, tc_user_id, team_id, tags').in('id', ids.slice(i, i + 200));
      if (error) throw error;
      found.push(...((data || []) as typeof found));
    }
    const accessible = found.filter((c) => canAccessContact(c, user.id, teamId));
    const ownIds = accessible.filter((c) => c.tc_user_id === user.id).map((c) => c.id);
    const teammateIds = accessible.filter((c) => c.tc_user_id !== user.id).map((c) => c.id);

    if (action === 'delete') {
      let removed = 0;
      for (let i = 0; i < ownIds.length; i += 200) {
        const { error } = await supabaseServer.from('contacts').delete().in('id', ownIds.slice(i, i + 200)).eq('tc_user_id', user.id);
        if (error) throw error;
        removed += Math.min(200, ownIds.length - i);
      }
      let unshared = 0;
      for (let i = 0; i < teammateIds.length && teamId; i += 200) {
        const chunk = teammateIds.slice(i, i + 200);
        const { error } = await supabaseServer.from('contacts').update({ team_id: null, shared_at: null }).in('id', chunk).eq('team_id', teamId);
        if (error) throw error;
        unshared += chunk.length;
      }
      return NextResponse.json({ success: true, count: removed, removedFromTeamOnly: unshared });
    }

    if (action === 'share_team') {
      if (!teamId) return NextResponse.json({ error: 'You are not on a team' }, { status: 400 });
      const r = await shareContactsToTeam(user.id, teamId, ownIds);
      return NextResponse.json({ success: true, ...r });
    }

    if (action === 'unshare_team') {
      for (let i = 0; i < ownIds.length; i += 200) {
        const { error } = await supabaseServer.from('contacts').update({ team_id: null, shared_at: null }).in('id', ownIds.slice(i, i + 200)).eq('tc_user_id', user.id);
        if (error) throw error;
      }
      return NextResponse.json({ success: true, count: ownIds.length });
    }

    if (action === 'subscribe' || action === 'unsubscribe') {
      let q = supabaseServer
        .from('contacts')
        .update({ newsletter: action === 'subscribe', updated_at: new Date().toISOString() })
        .in('id', ownIds)
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
    const rows = accessible;

    for (const row of rows as Pick<ContactRow, 'id' | 'tags'>[]) {
      const current = row.tags || [];
      const next =
        action === 'add_tag'
          ? cleanTags([...current, tag]).slice(0, MAX_TAGS_PER_CONTACT)
          : current.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      if (next.length === current.length && next.every((t, i) => t === current[i])) continue;
      const { error } = await supabaseServer
        .from('contacts')
        .update({ tags: next, updated_at: new Date().toISOString() })
        .eq('id', row.id);
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
