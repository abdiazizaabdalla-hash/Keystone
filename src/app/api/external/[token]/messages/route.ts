import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { afterClientMessage, fetchBoard, fetchPrivate, MAX_MESSAGE_LENGTH, type DbChannel } from '@/lib/clientMessages';

// PUBLIC; the progress-link token is the client's identity. A client can
// read and post on the shared board and in their own two private threads
// (with the agent, with the TC) -- never anyone else's.

async function loadLink(token: string) {
  const { data: link } = await supabaseServer
    .from('external_access_links')
    .select('id, transaction_id, scope, revoked_at, expires_at, client_name, client_email')
    .eq('token', token)
    .maybeSingle();
  if (!link || link.scope !== 'progress' || link.revoked_at || new Date(link.expires_at as string) < new Date()) return null;
  return link;
}

const invalid = () => NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 404 });
const tooMany = () => NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 });

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [ipOk, tokenOk] = await Promise.all([
    checkRateLimit(`external-msg-get:ip:${clientIp(request)}`, 120, 5 * 60),
    checkRateLimit(`external-msg-get:token:${token}`, 90, 5 * 60),
  ]);
  if (!ipOk || !tokenOk) return tooMany();

  const link = await loadLink(token);
  if (!link) return invalid();

  const channel = request.nextUrl.searchParams.get('channel');
  let rows;
  if (channel === 'board') rows = await fetchBoard(link.transaction_id as string);
  else if (channel === 'agent' || channel === 'tc') rows = await fetchPrivate(link.transaction_id as string, link.id as string, channel);
  else return NextResponse.json({ error: 'Unknown channel' }, { status: 400 });

  return NextResponse.json({
    messages: rows.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      senderType: m.sender_type,
      senderName: m.sender_name,
      mine: m.sender_type === 'client' && m.link_id === link.id,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [ipOk, tokenOk] = await Promise.all([
    checkRateLimit(`external-msg-post:ip:${clientIp(request)}`, 30, 10 * 60),
    checkRateLimit(`external-msg-post:token:${token}`, 20, 10 * 60),
  ]);
  if (!ipOk || !tokenOk) return tooMany();

  const link = await loadLink(token);
  if (!link) return invalid();

  const payload = await request.json().catch(() => ({}));
  const text = typeof payload.body === 'string' ? payload.body.trim() : '';
  const channel = payload.channel as DbChannel;
  if (channel !== 'board' && channel !== 'agent' && channel !== 'tc') {
    return NextResponse.json({ error: 'Unknown channel' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Message is too long (${MAX_MESSAGE_LENGTH} characters max)` }, { status: 400 });
  }

  const clientName = (link.client_name as string) || (link.client_email as string) || 'Your client';
  const { data, error } = await supabaseServer
    .from('client_messages')
    .insert({
      transaction_id: link.transaction_id,
      link_id: link.id,
      channel,
      sender_type: 'client',
      sender_user_id: null,
      sender_name: clientName,
      body: text,
    })
    .select('id, body, created_at, sender_type, sender_name')
    .single();
  if (error) {
    console.error('Error saving client message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }

  afterClientMessage({
    origin: request.nextUrl.origin,
    transactionId: link.transaction_id as string,
    channel,
    linkId: link.id as string,
    clientName,
    body: text,
  });

  return NextResponse.json(
    { id: data.id, body: data.body, createdAt: data.created_at, senderType: 'client', senderName: data.sender_name, mine: true },
    { status: 201 }
  );
}
