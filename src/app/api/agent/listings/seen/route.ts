import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getAgentListingRows } from '@/lib/agentListings';

// POST { ids }: the agent has now seen the "added to your listing" banner for these listings, so it will not show again
// (on any device). Only listings shared with this agent can be marked.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const asked: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string').slice(0, 100) : [];
    if (asked.length === 0) return NextResponse.json({ ok: true });
    const mine = new Set((await getAgentListingRows(user.email)).map((l) => l.id as string));
    const ids = asked.filter((id) => mine.has(id));
    if (ids.length === 0) return NextResponse.json({ ok: true });
    const { error } = await supabaseServer.from('listings').update({ agent_notice_seen: true }).in('id', ids);
    // add-listing-agent-notice.sql not run yet: the browser still remembers it on this device.
    if (error) console.error('Marking listing notices seen failed (ignored):', error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error marking listing notices seen:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
