import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail, getUserTeamId } from '@/lib/contactGuard';
import { cleanTags } from '@/lib/contactsCrm';
import { shareContactsToTeam, copyTeamContactsToMine } from '@/lib/contactSync';

type Keyed = { email: string | null; name: string };
const keyOf = (c: Keyed) => (c.email ? `e:${c.email.toLowerCase()}` : `n:${(c.name || '').trim().toLowerCase()}`);

// GET: what a sync would do right now (counts only), and whether the TC is on a team.
export async function GET(request: NextRequest) {
  try {
    const user = await requireContactsUser(request);
    const teamId = await getUserTeamId(user.id);
    if (!teamId) return NextResponse.json({ hasTeam: false, canShare: 0, canCopy: 0, sharedByMe: 0 });

    const [{ data: mine, error: e1 }, { data: theirs, error: e2 }, { data: teamAll, error: e3 }] = await Promise.all([
      supabaseServer.from('contacts').select('email, name, team_id').eq('tc_user_id', user.id).limit(5000),
      supabaseServer.from('contacts').select('email, name').eq('team_id', teamId).neq('tc_user_id', user.id).limit(5000),
      supabaseServer.from('contacts').select('email, name').eq('team_id', teamId).limit(10000),
    ]);
    if (e1 || e2 || e3) throw e1 || e2 || e3;
    const onTeam = new Set((teamAll || []).map((c) => keyOf(c as Keyed)));
    const mineKeys = new Set((mine || []).map((c) => keyOf(c as Keyed)));
    return NextResponse.json({
      hasTeam: true,
      canShare: (mine || []).filter((c) => !c.team_id && !onTeam.has(keyOf(c as Keyed))).length,
      canCopy: (theirs || []).filter((c) => !mineKeys.has(keyOf(c as Keyed))).length,
      sharedByMe: (mine || []).filter((c) => c.team_id).length,
    });
  } catch (error) {
    return contactsFail(error, 'check contact sync');
  }
}

// POST { share?: boolean, copy?: boolean, tag?: string }
//   share: share all of my personal contacts (or only those with `tag`) with the team
//   copy:  copy contacts my teammates shared into my own list
export async function POST(request: NextRequest) {
  try {
    const user = await requireContactsUser(request, { write: true });
    const teamId = await getUserTeamId(user.id);
    if (!teamId) return NextResponse.json({ error: 'You are not on a team' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    if (body.share !== true && body.copy !== true) return NextResponse.json({ error: 'Nothing to sync' }, { status: 400 });

    const result = { shared: 0, sharedSkipped: 0, copied: 0, copiedSkipped: 0 };

    // Copy first, so contacts just shared are not copied straight back.
    if (body.copy === true) {
      const r = await copyTeamContactsToMine(user.id, teamId);
      result.copied = r.copied;
      result.copiedSkipped = r.skippedDuplicate;
    }
    if (body.share === true) {
      const tag = typeof body.tag === 'string' ? cleanTags([body.tag])[0] : undefined;
      let q = supabaseServer.from('contacts').select('id').eq('tc_user_id', user.id).is('team_id', null).limit(5000);
      if (tag) q = q.contains('tags', [tag]);
      const { data, error } = await q;
      if (error) throw error;
      const r = await shareContactsToTeam(user.id, teamId, (data || []).map((c) => c.id as string));
      result.shared = r.shared;
      result.sharedSkipped = r.skippedDuplicate;
    }
    return NextResponse.json(result);
  } catch (error) {
    return contactsFail(error, 'sync contacts');
  }
}
