import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';

// The deals a contact appears on: matched by email against the deal contact lists
// and the agents on this TC's (and their team's) deals. Read-only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) throw new AuthError('Not available', 403);

    const { data: contact } = await supabaseServer.from('contacts').select('email').eq('id', id).eq('tc_user_id', user.id).maybeSingle();
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const email = (contact.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ deals: [] });

    const visibleIds = await getVisibleTcUserIds(user.id);
    const { data: myAgents } = await supabaseServer.from('agents').select('id, email').in('tc_user_id', visibleIds);
    const agentIds = (myAgents || []).map((a) => a.id as string);
    if (agentIds.length === 0) return NextResponse.json({ deals: [] });
    const agentIdsForEmail = (myAgents || []).filter((a) => (a.email || '').toLowerCase() === email).map((a) => a.id as string);

    const { data: txs } = await supabaseServer
      .from('transactions')
      .select('id, property_address, file_number, status, closing_date, agent_id')
      .in('agent_id', agentIds)
      .order('created_at', { ascending: false })
      .limit(2000);
    const byId = new Map((txs || []).map((t) => [t.id as string, t]));
    const found = new Map<string, { id: string; property_address: string; file_number: string | null; status: string | null; closing_date: string | null; as: string }>();

    for (const t of txs || []) {
      if (agentIdsForEmail.includes(t.agent_id as string)) {
        found.set(t.id as string, { id: t.id, property_address: t.property_address, file_number: t.file_number, status: t.status, closing_date: t.closing_date, as: 'Agent' });
      }
    }
    const txIds = [...byId.keys()];
    for (let i = 0; i < txIds.length; i += 200) {
      const { data: parts } = await supabaseServer
        .from('transaction_contacts')
        .select('transaction_id, role')
        .in('transaction_id', txIds.slice(i, i + 200))
        .ilike('email', email);
      for (const p of parts || []) {
        const t = byId.get(p.transaction_id as string);
        if (t && !found.has(t.id as string)) {
          found.set(t.id as string, { id: t.id, property_address: t.property_address, file_number: t.file_number, status: t.status, closing_date: t.closing_date, as: (p.role as string) || 'Contact' });
        }
      }
    }
    return NextResponse.json({ deals: [...found.values()].slice(0, 100) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading contact deals:', error);
    return NextResponse.json({ error: 'Failed to load deals' }, { status: 500 });
  }
}
