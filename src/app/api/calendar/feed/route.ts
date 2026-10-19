import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// A private, subscribe-once calendar link (.ics) for the signed-in user -- a
// TC or an agent. It works with ANY calendar app (Google, Apple, Outlook), needs
// no Google permissions at all, and updates itself as dates change. The token in
// the URL is the credential, so it is long and random, and can be regenerated to
// invalidate a link that leaked.

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function feedUrl(origin: string, token: string) {
  const https = `${origin}/api/calendar/ics/${token}`;
  return { url: https, webcalUrl: https.replace(/^https?:/, 'webcal:') };
}

// GET: returns the user's feed link, creating one the first time.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const origin = new URL(request.url).origin;

    const { data: existing } = await supabaseServer
      .from('calendar_feed_tokens')
      .select('token')
      .eq('user_id', user.id)
      .maybeSingle();

    let token = existing?.token as string | undefined;
    if (!token) {
      token = newToken();
      const { error } = await supabaseServer.from('calendar_feed_tokens').insert({ user_id: user.id, token });
      if (error) throw error;
    }
    return NextResponse.json(feedUrl(origin, token));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error loading calendar feed link:', error);
    return NextResponse.json({ error: 'Failed to load your calendar link' }, { status: 500 });
  }
}

// POST: replaces the link with a fresh one (the old link stops working).
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const origin = new URL(request.url).origin;
    const token = newToken();
    const { error } = await supabaseServer
      .from('calendar_feed_tokens')
      .upsert({ user_id: user.id, token, created_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json(feedUrl(origin, token));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error regenerating calendar feed link:', error);
    return NextResponse.json({ error: 'Failed to reset your calendar link' }, { status: 500 });
  }
}
