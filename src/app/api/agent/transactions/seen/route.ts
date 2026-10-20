import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';

// POST { ids }: the agent has now seen the "new on your dashboard" notice for these deals, so it will not show again
// (on any device). Only touches this agent's own access rows.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string').slice(0, 100) : [];
    if (ids.length === 0) return NextResponse.json({ ok: true });
    const { error } = await supabaseServer.from('transaction_agents').update({ notice_seen: true }).eq('agent_user_id', user.id).in('transaction_id', ids);
    // add-agent-notice-seen.sql not run yet: the browser still remembers it on this device.
    if (error) console.error('Marking notices seen failed (ignored):', error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error marking agent notices seen:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
