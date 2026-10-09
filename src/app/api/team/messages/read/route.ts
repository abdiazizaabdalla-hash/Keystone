import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getMessagingContext, parseThread, threadKey, describeMessagingError, SETUP_MISSING_RESPONSE } from '@/lib/teamMessaging';

// POST /api/team/messages/read { thread, upTo } -- records that the caller
// has read a conversation up to the given message timestamp (taken from
// the message itself, so server/client clock differences can't skip or
// re-flag messages). Never moves the marker backwards.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const ctx = await getMessagingContext(user.id);
    const payload = await request.json().catch(() => ({}));
    const thread = threadKey(parseThread(payload?.thread, user.id, ctx.memberIds));

    const upToMs = typeof payload?.upTo === 'string' ? Date.parse(payload.upTo) : NaN;
    if (Number.isNaN(upToMs)) {
      return NextResponse.json({ error: 'upTo is required' }, { status: 400 });
    }
    const upTo = new Date(Math.min(upToMs, Date.now() + 60_000)).toISOString();

    const { data: existing } = await supabaseServer
      .from('team_message_reads')
      .select('last_read_at')
      .eq('user_id', user.id)
      .eq('team_id', ctx.teamId)
      .eq('thread', thread)
      .maybeSingle();

    if (existing && Date.parse(existing.last_read_at) >= Date.parse(upTo)) {
      return NextResponse.json({ status: 'ok' });
    }

    const { error } = await supabaseServer
      .from('team_message_reads')
      .upsert({ user_id: user.id, team_id: ctx.teamId, thread, last_read_at: upTo });
    if (error) throw error;
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (describeMessagingError('Error marking team messages read:', error).setupMissing) {
      return NextResponse.json(SETUP_MISSING_RESPONSE, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to update read state' }, { status: 500 });
  }
}
