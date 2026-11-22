import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { sendClientAccessEmail } from '@/lib/agentPortalEmails';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// POST { email }: a client (a buyer or seller who was given a progress page by their agent or coordinator) asks for their link again.
// If that email has active progress links, one email goes out with a link for each. It always answers the same way, so it cannot be
// used to find out whose email is on a transaction, and it is rate limited by address and by email.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    const ip = getClientIp(request);
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(`client-link:ip:${ip}`, 10, 10 * 60),
      checkRateLimit(`client-link:email:${email}`, 3, 10 * 60),
    ]);
    if (!ipOk || !emailOk) {
      return NextResponse.json({ error: 'Too many requests. Please wait a few minutes and try again.' }, { status: 429 });
    }

    const { data: links } = await supabaseServer
      .from('external_access_links')
      .select('token, transaction_id, expires_at, created_at')
      .eq('scope', 'progress')
      .is('revoked_at', null)
      .ilike('client_email', email.replace(/[\\%_]/g, '\\$&'))
      .order('created_at', { ascending: false })
      .limit(20);
    const now = Date.now();
    const live = (links ?? []).filter((l) => !l.expires_at || new Date(l.expires_at as string).getTime() > now);
    // One link per transaction (the newest), at most five.
    const seen = new Set<string>();
    const picked = live.filter((l) => (seen.has(l.transaction_id as string) ? false : (seen.add(l.transaction_id as string), true))).slice(0, 5);

    if (picked.length > 0) {
      const { data: tx } = await supabaseServer.from('transactions').select('id, property_address').in('id', picked.map((l) => l.transaction_id as string));
      const address = new Map((tx ?? []).map((t) => [t.id as string, (t.property_address as string | null) ?? null]));
      const origin = request.nextUrl.origin;
      await sendClientAccessEmail({
        toEmail: email,
        links: picked.map((l) => ({ propertyAddress: address.get(l.transaction_id as string) ?? null, url: `${origin}/external/${l.token}` })),
      });
    }
    return NextResponse.json({ status: 'sent' });
  } catch (error) {
    console.error('Error sending client progress links:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
