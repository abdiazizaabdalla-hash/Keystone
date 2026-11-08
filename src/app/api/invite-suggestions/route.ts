import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertNotCollaborator } from '@/lib/workspaceGuard';
import { getEntitlements } from '@/lib/entitlements';
import { getVisibleTcUserIds } from '@/lib/team';

// Who to offer when someone is being added to a deal or listing, so nobody has to type an email:
//  role=tc    (an agent with a workspace): coordinators this agent already invited, most recent first.
//  role=agent (a coordinator): their agents and contacts, the agents on their latest deals and listings first.
export type InviteSuggestion = { name: string; email: string; source: 'recent' | 'agent' | 'contact'; recent: boolean; agentId?: string };

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertNotCollaborator(user);
    const role = request.nextUrl.searchParams.get('role') === 'tc' ? 'tc' : 'agent';
    const byEmail = new Map<string, InviteSuggestion>();
    const add = (s: InviteSuggestion) => {
      const key = norm(s.email);
      if (!key.includes('@') || key === norm(user.email)) return;
      const have = byEmail.get(key);
      if (!have) byEmail.set(key, { ...s, email: key });
      else if (s.recent && !have.recent) byEmail.set(key, { ...have, recent: true, agentId: have.agentId || s.agentId });
    };

    if (role === 'tc') {
      if (getEntitlements(user).kind !== 'agent_workspace') throw new AuthError('Only an agent with a workspace invites a coordinator', 403);
      const [{ data: deals }, { data: lists }] = await Promise.all([
        supabaseServer.from('agent_invites').select('email, created_at').eq('invited_by', user.id).order('created_at', { ascending: false }).limit(30),
        supabaseServer.from('listing_coordinators').select('email, created_at, coordinator_user_id').eq('invited_by', user.id).order('created_at', { ascending: false }).limit(30),
      ]);
      const rows = [
        ...(deals || []).map((r) => ({ email: r.email as string, at: r.created_at as string, userId: null as string | null })),
        ...(lists || []).map((r) => ({ email: r.email as string, at: r.created_at as string, userId: (r.coordinator_user_id as string | null) || null })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      for (const r of rows) {
        let name = norm(r.email);
        if (r.userId) {
          const { data: u } = await supabaseServer.auth.admin.getUserById(r.userId);
          name = (u.user?.user_metadata?.full_name as string | undefined)?.trim() || name;
        }
        add({ name, email: r.email, source: 'recent', recent: true });
      }
    } else {
      const visible = await getVisibleTcUserIds(user.id);
      const [{ data: agents }, { data: txs }, { data: lists }, { data: contacts }] = await Promise.all([
        supabaseServer.from('agents').select('id, name, email').in('tc_user_id', visible).not('email', 'is', null).limit(500),
        supabaseServer.from('transactions').select('agent_id').in('tc_user_id', visible).order('created_at', { ascending: false }).limit(25),
        supabaseServer.from('listings').select('agent_id').in('tc_user_id', visible).order('created_at', { ascending: false }).limit(25),
        supabaseServer.from('contacts').select('name, email, role').eq('tc_user_id', user.id).ilike('role', '%agent%').not('email', 'is', null).limit(500),
      ]);
      const recentIds: string[] = [];
      for (const r of [...(txs || []), ...(lists || [])]) if (r.agent_id && !recentIds.includes(r.agent_id as string)) recentIds.push(r.agent_id as string);
      const agentById = new Map((agents || []).map((a) => [a.id as string, a]));
      for (const id of recentIds) {
        const a = agentById.get(id);
        if (a) add({ name: a.name as string, email: a.email as string, source: 'recent', recent: true, agentId: a.id as string });
      }
      for (const a of [...(agents || [])].sort((x, y) => String(x.name).localeCompare(String(y.name)))) {
        add({ name: a.name as string, email: a.email as string, source: 'agent', recent: false, agentId: a.id as string });
      }
      for (const c of contacts || []) add({ name: (c.name as string) || (c.email as string), email: c.email as string, source: 'contact', recent: false });
    }
    return NextResponse.json({ suggestions: [...byEmail.values()].slice(0, 100) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('invite suggestions failed:', error);
    return NextResponse.json({ error: 'Failed to load suggestions' }, { status: 500 });
  }
}
