import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser } from '@/lib/team';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';

const CLOSED_STATUS = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1];

// GET /api/team/agents
//
// The brokerage's own agent directory (see add-brokerage-agent-
// directory.sql) -- a roster of real agents associated with the
// brokerage, distinct from any individual TC's per-transaction
// invoicing contact and distinct from the free agent-portal login.
// Readable by any team member -- a regular TC needs this list to link
// a new per-TC agent contact to the right directory entry when they
// create one (see POST /api/agents' brokerageAgentId, and the "Add
// Agent" form) -- but the per-entry stats (how many TCs/transactions)
// are owner-only insight, same as the rest of /dashboard/collaborate's
// admin surface, so a non-owner gets just {id, name, email, phone}.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const membership = await getTeamForUser(user.id);
    if (!membership) {
      return NextResponse.json({ error: 'You are not on a team' }, { status: 403 });
    }
    const isOwner = membership.role === 'owner';

    const { data: directory, error } = await supabaseServer
      .from('brokerage_agents')
      .select('*')
      .eq('team_id', membership.team.id)
      .order('name', { ascending: true });
    if (error) throw error;

    if (!isOwner) {
      return NextResponse.json(
        (directory || []).map((entry) => ({
          id: entry.id,
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
        }))
      );
    }

    const entries = await Promise.all(
      (directory || []).map(async (entry) => {
        const { data: linkedContacts } = await supabaseServer
          .from('agents')
          .select('id, tc_user_id')
          .eq('brokerage_agent_id', entry.id);

        const contactIds = (linkedContacts || []).map((c) => c.id as string);
        const tcUserIds = new Set((linkedContacts || []).map((c) => c.tc_user_id as string));

        let activeTransactions = 0;
        let totalTransactions = 0;
        if (contactIds.length > 0) {
          const { data: txRows } = await supabaseServer
            .from('transactions')
            .select('status')
            .in('agent_id', contactIds);
          totalTransactions = (txRows || []).length;
          activeTransactions = (txRows || []).filter((t) => t.status !== CLOSED_STATUS).length;
        }

        return {
          id: entry.id,
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
          tcCount: tcUserIds.size,
          activeTransactions,
          totalTransactions,
        };
      })
    );

    return NextResponse.json(entries);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching brokerage agent directory:', error);
    return NextResponse.json({ error: 'Failed to fetch agent directory' }, { status: 500 });
  }
}

// POST /api/team/agents
//
// Adds a new entry to the brokerage's agent directory. Owner-only.
// Deliberately does NOT create a Relay login -- a brokerage can have
// hundreds of agents without 350 accounts suddenly existing; a login
// only ever gets created the existing way, by inviting someone to a
// specific transaction (see POST /api/agent-invites), independent of
// whether they're in this directory.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json();
    const { name, email, phone } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can add to the agent directory' }, { status: 403 });
    }

    const { data: entry, error } = await supabaseServer
      .from('brokerage_agents')
      .insert({
        team_id: membership.team.id,
        name: name.trim(),
        email: email || null,
        phone: phone || null,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error adding to brokerage agent directory:', error);
    return NextResponse.json({ error: 'Failed to add agent' }, { status: 500 });
  }
}
