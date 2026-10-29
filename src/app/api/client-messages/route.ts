import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import {
  loadStaffContext,
  listActiveClients,
  fetchBoard,
  fetchPrivate,
  afterStaffMessage,
  MAX_MESSAGE_LENGTH,
  type DbChannel,
} from '@/lib/clientMessages';

// The agent's and TC's side of client messaging. One endpoint for both: the
// caller's role decides which private thread they can reach. An agent's
// 'private' is the agent<->client thread; a TC's is the TC<->client thread,
// and neither can read the other's. The shared board is open to both.

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`Error ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

// GET ?transactionId=&channel=board|private[&linkId=]
// Always returns the deal's clients (for the tabs); returns messages when asked for a thread.
export async function GET(request: NextRequest) {
  try {
    const transactionId = request.nextUrl.searchParams.get('transactionId') || '';
    if (!transactionId) return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    const ctx = await loadStaffContext(request, transactionId);

    const clients = (await listActiveClients(transactionId)).map((c) => ({ id: c.id, name: c.name, email: c.email }));
    const channel = request.nextUrl.searchParams.get('channel');
    const linkId = request.nextUrl.searchParams.get('linkId');

    let messages: unknown[] = [];
    if (channel === 'board') {
      messages = await fetchBoard(transactionId);
    } else if (channel === 'private' && linkId) {
      if (!clients.some((c) => c.id === linkId)) {
        return NextResponse.json({ error: 'Client not found on this deal' }, { status: 404 });
      }
      messages = await fetchPrivate(transactionId, linkId, ctx.role);
    }
    return NextResponse.json({ role: ctx.role, clients, messages });
  } catch (error) {
    return fail(error, 'load client messages');
  }
}

// POST { transactionId, channel: 'board' | 'private', linkId?, body }
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));
    const transactionId = typeof payload.transactionId === 'string' ? payload.transactionId : '';
    const text = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!transactionId) return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
    if (text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Message is too long (${MAX_MESSAGE_LENGTH} characters max)` }, { status: 400 });
    }
    const ctx = await loadStaffContext(request, transactionId);

    let channel: DbChannel;
    let linkId: string | null = null;
    if (payload.channel === 'board') {
      channel = 'board';
    } else if (payload.channel === 'private' && typeof payload.linkId === 'string') {
      const clients = await listActiveClients(transactionId);
      if (!clients.some((c) => c.id === payload.linkId)) {
        return NextResponse.json({ error: 'Client not found on this deal' }, { status: 404 });
      }
      channel = ctx.role;
      linkId = payload.linkId;
    } else {
      return NextResponse.json({ error: 'Choose the board or a client' }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from('client_messages')
      .insert({
        transaction_id: transactionId,
        link_id: linkId,
        channel,
        sender_type: ctx.role,
        sender_user_id: ctx.user.id,
        sender_name: ctx.label,
        body: text,
      })
      .select('id, link_id, channel, sender_type, sender_name, body, created_at')
      .single();
    if (error) throw error;

    afterStaffMessage({ request, ctx, transactionId, channel, linkId, body: text });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return fail(error, 'send message');
  }
}
