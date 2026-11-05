import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { findUserIdByEmail } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import {
  MAX_LINKS_PER_OWNER,
  OVERSIGHT_TERMS,
  agentLabels,
  assertBrokerageOwner,
  cleanEmail,
  listOwnerLinks,
  loadOversightDeals,
  productionFor,
} from '@/lib/oversight';
import { assertCanInvite } from '@/lib/brokerageAccount';
import { isDuplicateLink, oversightError, sendBrokerageInvite, todayIso } from '@/lib/oversightServer';

// The brokerage owner's view of their roster.
// GET: every invited and joined agent, with production and what needs attention, plus totals.
// POST { email }: invite an agent. Accepting gives them a free Basic workspace (see agentAccess.ts); an agent with a workspace of their own keeps it.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    if (request.nextUrl.searchParams.get('check') === '1') return NextResponse.json({ owner: true });
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const activeIds = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    const labels = await agentLabels(activeIds);
    const deals = await loadOversightDeals(activeIds, today);

    const agents = links.map((l) => {
      const mine = l.agent_user_id ? deals.filter((d) => d.tc_user_id === l.agent_user_id) : [];
      const production = productionFor(mine, today);
      return {
        linkId: l.id,
        status: l.status,
        email: l.invited_email,
        name: (l.agent_user_id && labels.get(l.agent_user_id)?.name) || l.invited_email,
        userId: l.status === 'active' ? l.agent_user_id : null,
        invitedAt: l.invited_at,
        joinedAt: l.responded_at,
        baseCommission: l.default_split_type && l.default_split_value !== null && l.default_split_value !== undefined ? { type: l.default_split_type, value: Number(l.default_split_value) } : null,
        production,
        overdueTasks: mine.reduce((n, d) => n + d.health.overdueTasks, 0),
        needsAttention: mine.filter((d) => d.health.flags.length > 0).length,
      };
    });

    const totals = agents.reduce(
      (t, a) => ({
        agents: t.agents + (a.status === 'active' ? 1 : 0),
        pending: t.pending + (a.status === 'pending' ? 1 : 0),
        activeDeals: t.activeDeals + a.production.activeDeals,
        overdueTasks: t.overdueTasks + a.overdueTasks,
        needsAttention: t.needsAttention + a.needsAttention,
        closedThisYear: t.closedThisYear + a.production.closedThisYear,
        volumeThisYear: t.volumeThisYear + a.production.volumeThisYear,
        closedLast30Days: t.closedLast30Days + a.production.closedLast30Days,
      }),
      { agents: 0, pending: 0, activeDeals: 0, overdueTasks: 0, needsAttention: 0, closedThisYear: 0, volumeThisYear: 0, closedLast30Days: 0 }
    );

    return NextResponse.json({ agents, totals, terms: OVERSIGHT_TERMS });
  } catch (error) {
    return oversightError(error, 'load your brokerage');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    const email = cleanEmail(body.email);
    if (email === (user.email ?? '').toLowerCase()) throw new AuthError('You cannot invite yourself.', 400);

    const { data: open } = await supabaseServer.from('brokerage_links').select('status').eq('owner_user_id', user.id).in('status', ['pending', 'active']);
    const count = (open ?? []).length;
    await assertCanInvite(user.id, { active: (open ?? []).filter((l) => l.status === 'active').length, pending: (open ?? []).filter((l) => l.status === 'pending').length });
    if ((count ?? 0) >= MAX_LINKS_PER_OWNER) throw new AuthError(`You can have up to ${MAX_LINKS_PER_OWNER} agents and invitations.`, 400);

    // If they already have an account the invite is waiting on their page; if not, it waits for the email they sign up with.
    const agentUserId = await findUserIdByEmail(email).catch(() => null);
    if (agentUserId === user.id) throw new AuthError('You cannot invite yourself.', 400);

    const { data, error } = await supabaseServer
      .from('brokerage_links')
      .insert({ owner_user_id: user.id, agent_user_id: agentUserId, invited_email: email, status: 'pending' })
      .select('id, status, invited_email, invited_at')
      .single();
    if (isDuplicateLink(error)) throw new AuthError('That person is already invited or on your team.', 409);
    if (error) throw error;

    const ownerLabel = (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) || user.email || 'A brokerage owner';
    const delivery = await sendBrokerageInvite({ ownerUserId: user.id, ownerLabel, toEmail: email });
    await logAudit(request, user, 'brokerage.invite', { entityType: 'brokerage_link', entityId: data.id, metadata: { delivery } });
    return NextResponse.json({ ...data, delivery }, { status: 201 });
  } catch (error) {
    return oversightError(error, 'invite that agent');
  }
}
