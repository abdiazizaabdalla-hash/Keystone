import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { agentLabels, brokerageOn } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { BROKERAGE_MESSAGE_MAX, messagePartners, resolvePair, summarise, type BrokerageMessageRow } from '@/lib/brokerageMessages';

// Private messages between a brokerage owner and one of their agents. Off (404) unless the brokerage feature is on.
//
//   GET               -> { conversations: [{ id, role, name, email, lastMessage, unread }], unread }
//   GET ?with=<id>    -> { name, role, messages }   and marks what they sent you as read
//   POST { with, body } -> the new message
//
// A thread is readable only by the owner and that one agent, and only while their link is active.

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const withId = request.nextUrl.searchParams.get('with');

    if (withId) {
      const pair = await resolvePair(user.id, withId);
      if (!pair) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      const [{ data }, labels] = await Promise.all([
        supabaseServer.from('brokerage_messages').select('id, sender_id, body, created_at, read_at').eq('owner_user_id', pair.ownerId).eq('agent_user_id', pair.agentId).order('created_at', { ascending: true }).limit(500),
        agentLabels([withId]),
      ]);
      await supabaseServer.from('brokerage_messages').update({ read_at: new Date().toISOString() }).eq('owner_user_id', pair.ownerId).eq('agent_user_id', pair.agentId).neq('sender_id', user.id).is('read_at', null);
      const who = labels.get(withId);
      return NextResponse.json({ name: who?.name ?? 'Member', role: pair.me === 'owner' ? 'agent' : 'owner', messages: data ?? [] });
    }

    const partners = await messagePartners(user.id);
    if (partners.length === 0) return NextResponse.json({ conversations: [], unread: 0 });
    const [labels, { data: rows }] = await Promise.all([
      agentLabels(partners.map((p) => p.id)),
      supabaseServer.from('brokerage_messages').select('owner_user_id, agent_user_id, sender_id, body, created_at, read_at').or(`owner_user_id.eq.${user.id},agent_user_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(1000),
    ]);
    const { last, unread } = summarise(user.id, (rows ?? []) as BrokerageMessageRow[]);
    const conversations = partners
      .map((p) => ({ id: p.id, role: p.role, name: labels.get(p.id)?.name ?? 'Member', email: labels.get(p.id)?.email ?? null, lastMessage: last.get(p.id) ?? null, unread: unread.get(p.id) ?? 0 }))
      .sort((a, b) => {
        const at = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : -1;
        const bt = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : -1;
        return bt - at || a.name.localeCompare(b.name);
      });
    return NextResponse.json({ conversations, unread: conversations.reduce((n, c) => n + c.unread, 0) });
  } catch (error) {
    return oversightError(error, 'load messages');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    if (!(await checkRateLimit(`brokerage-message:${user.id}`, 120, 60 * 60))) {
      return NextResponse.json({ error: 'You have sent a lot of messages. Try again a bit later.' }, { status: 429 });
    }
    const input = await request.json().catch(() => ({}));
    const withId = typeof input.with === 'string' ? input.with : '';
    const text = typeof input.body === 'string' ? input.body.trim() : '';
    if (!withId) return NextResponse.json({ error: 'Choose who to message' }, { status: 400 });
    if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
    if (text.length > BROKERAGE_MESSAGE_MAX) return NextResponse.json({ error: `Message is too long (${BROKERAGE_MESSAGE_MAX} characters max)` }, { status: 400 });

    const pair = await resolvePair(user.id, withId);
    if (!pair) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    // Only ring the bell if they have not already got an unread message from me, so a burst is one notification.
    const { data: waiting } = await supabaseServer.from('brokerage_messages').select('id').eq('owner_user_id', pair.ownerId).eq('agent_user_id', pair.agentId).eq('sender_id', user.id).is('read_at', null).limit(1);

    const { data: message, error } = await supabaseServer
      .from('brokerage_messages')
      .insert({ owner_user_id: pair.ownerId, agent_user_id: pair.agentId, sender_id: user.id, body: text })
      .select('id, sender_id, body, created_at, read_at')
      .single();
    if (error) throw error;

    if (!waiting || waiting.length === 0) {
      const name = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || 'Someone';
      await supabaseServer
        .from('notifications')
        .insert({ recipient_user_id: withId, actor_user_id: user.id, event_type: 'brokerage_message', title: `${name} sent you a private message`.slice(0, 200), link: pair.me === 'owner' ? '/dashboard/brokerage' : '/dashboard/collaborate#messages' })
        .then(({ error: e }) => e && console.error('Brokerage message notification failed:', e));
    }

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    return oversightError(error, 'send the message');
  }
}
