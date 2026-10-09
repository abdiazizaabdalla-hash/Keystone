import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { getMessagingContext, parseThread, MAX_TEAM_MESSAGE_LENGTH } from '@/lib/teamMessaging';

interface MessageRow {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  body: string;
  created_at: string;
}

function toJson(row: MessageRow) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

// GET /api/team/messages?thread=board|<teammateUserId>[&since=<iso>]
// Returns the newest 100 messages of one conversation, oldest first. With
// `since`, returns only messages newer than that timestamp (for polling).
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const ctx = await getMessagingContext(user.id);
    const { searchParams } = new URL(request.url);
    const thread = parseThread(searchParams.get('thread'), user.id, ctx.memberIds);

    const sinceParam = searchParams.get('since');
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam).toISOString() : null;

    let query = supabaseServer
      .from('team_messages')
      .select('id, sender_id, recipient_id, body, created_at')
      .eq('team_id', ctx.teamId);

    if (thread.kind === 'board') {
      query = query.is('recipient_id', null);
    } else {
      // Both ids were validated as uuids of real teammates by parseThread.
      query = query.or(
        `and(sender_id.eq.${user.id},recipient_id.eq.${thread.otherId}),and(sender_id.eq.${thread.otherId},recipient_id.eq.${user.id})`
      );
    }

    if (since) {
      const { data, error } = await query.gt('created_at', since).order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      return NextResponse.json({ messages: ((data as MessageRow[]) || []).map(toJson), ownerId: ctx.ownerId });
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const messages = ((data as MessageRow[]) || []).reverse().map(toJson);
    return NextResponse.json({ messages, ownerId: ctx.ownerId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error loading team messages:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

// POST /api/team/messages { thread, body } -- post to the board or send a
// direct message to a teammate.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const ctx = await getMessagingContext(user.id);
    const payload = await request.json().catch(() => ({}));
    const thread = parseThread(payload?.thread, user.id, ctx.memberIds);

    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    if (!body) {
      return NextResponse.json({ error: 'Write a message first.' }, { status: 400 });
    }
    if (body.length > MAX_TEAM_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Messages can be up to ${MAX_TEAM_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    if (!(await checkRateLimit(`team-msg:${user.id}`, 30, 60))) {
      return NextResponse.json({ error: 'You are sending messages too fast. Wait a moment.' }, { status: 429 });
    }

    const { data, error } = await supabaseServer
      .from('team_messages')
      .insert({
        team_id: ctx.teamId,
        sender_id: user.id,
        recipient_id: thread.kind === 'dm' ? thread.otherId : null,
        body,
      })
      .select('id, sender_id, recipient_id, body, created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ message: toJson(data as MessageRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error sending team message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
