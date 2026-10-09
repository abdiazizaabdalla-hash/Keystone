import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser } from '@/lib/team';
import { BOARD_THREAD, describeMessagingError, SETUP_MISSING_RESPONSE } from '@/lib/teamMessaging';

const LOOKBACK_DAYS = 30;

// GET /api/team/messages/summary -- unread counts per conversation, used
// for the badge on the Collaborate nav item and the conversation list.
// Someone not on a team just gets zeros (no error), since the nav polls
// this for every Team-plan user.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const membership = await getTeamForUser(user.id);
    if (!membership) {
      return NextResponse.json({ total: 0, byThread: {} });
    }
    const teamId = membership.team.id;

    const [{ data: reads }, { data: incoming, error }] = await Promise.all([
      supabaseServer.from('team_message_reads').select('thread, last_read_at').eq('user_id', user.id).eq('team_id', teamId),
      supabaseServer
        .from('team_messages')
        .select('sender_id, recipient_id, created_at')
        .eq('team_id', teamId)
        .neq('sender_id', user.id)
        .or(`recipient_id.is.null,recipient_id.eq.${user.id}`)
        .gt('created_at', new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(2000),
    ]);
    if (error) throw error;

    const lastRead = new Map<string, number>(
      ((reads as { thread: string; last_read_at: string }[]) || []).map((r) => [r.thread, Date.parse(r.last_read_at)])
    );

    const byThread: Record<string, number> = {};
    let total = 0;
    for (const m of (incoming as { sender_id: string; recipient_id: string | null; created_at: string }[]) || []) {
      const key = m.recipient_id === null ? BOARD_THREAD : m.sender_id;
      if (Date.parse(m.created_at) > (lastRead.get(key) ?? 0)) {
        byThread[key] = (byThread[key] || 0) + 1;
        total += 1;
      }
    }

    return NextResponse.json({ total, byThread });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (describeMessagingError('Error loading team message summary:', error).setupMissing) {
      return NextResponse.json(SETUP_MISSING_RESPONSE, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to load message summary' }, { status: 500 });
  }
}
