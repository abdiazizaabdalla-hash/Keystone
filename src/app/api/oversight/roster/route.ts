import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { CLOSED_STAGE, agentLabels, assertBrokerageOwner, isOpenListing, listOwnerLinks, loadOversightDeals, loadOversightListings, productionFor } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { viewOf, type CommissionRow } from '@/lib/commissions';

// A quick snapshot of every agent in the brokerage, for the Agents page: who they are, how many deals and listings,
// the current ones, their latest commission statements and base commission. Nothing private to the agent.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const active = links.filter((l) => l.status === 'active' && l.agent_user_id);
    const ids = active.map((l) => l.agent_user_id as string);

    const [labels, deals, listings, { data: commissionRows }, { data: agentRows }] = await Promise.all([
      agentLabels(ids),
      loadOversightDeals(ids, today),
      loadOversightListings(ids, today),
      ids.length ? supabaseServer.from('deal_commissions').select('*').eq('owner_user_id', user.id).order('proposed_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
      ids.length ? supabaseServer.from('agents').select('tc_user_id, phone, created_at').in('tc_user_id', ids).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
    ]);

    const phoneOf = new Map<string, string | null>();
    for (const r of agentRows ?? []) if (!phoneOf.has(r.tc_user_id as string)) phoneOf.set(r.tc_user_id as string, (r.phone as string | null) ?? null);
    const addressOf = new Map(deals.map((d) => [d.id, d.property_address]));
    const commissions = ((commissionRows ?? []) as CommissionRow[]).map((r) => ({ ...viewOf(r), agentId: r.agent_user_id, property: addressOf.get(r.transaction_id) ?? null, agentNetCents: r.agent_net_cents }));

    const agents = active
      .map((l) => {
        const id = l.agent_user_id as string;
        const label = labels.get(id);
        const mine = deals.filter((d) => d.tc_user_id === id);
        const open = mine.filter((d) => d.status !== CLOSED_STAGE);
        const ml = listings.filter((x) => x.tc_user_id === id && isOpenListing(x.status));
        const mc = commissions.filter((c) => c.agentId === id && c.status !== 'void');
        const production = productionFor(mine, today);
        return {
          id,
          linkId: l.id,
          name: label?.name ?? 'Agent',
          email: label?.email ?? null,
          phone: phoneOf.get(id) ?? null,
          joinedAt: l.responded_at,
          baseCommission: l.default_split_type && l.default_split_value !== null && l.default_split_value !== undefined ? { type: l.default_split_type, value: Number(l.default_split_value) } : null,
          openDeals: open.length,
          pipelineVolume: production.pipelineVolume,
          closedThisYear: production.closedThisYear,
          volumeThisYear: production.volumeThisYear,
          openListings: ml.length,
          needsAttention: open.filter((d) => d.health.flags.length > 0).length + ml.filter((x) => x.health.flags.length > 0).length,
          currentDeals: [...open].sort((a, b) => (a.closing_date ?? '9999').localeCompare(b.closing_date ?? '9999')).slice(0, 3).map((d) => ({ id: d.id, address: d.property_address, status: d.status, closingDate: d.closing_date, flags: d.health.flags, nextStep: d.nextStep })),
          currentListings: ml.slice(0, 2).map((x) => ({ id: x.id, address: x.property_address, status: x.status, listPrice: x.list_price, flags: x.health.flags })),
          recentCommissions: mc.slice(0, 3).map((c) => ({ id: c.id, transactionId: c.transactionId, statementNumber: c.statementNumber, property: c.property, agentNet: c.agentNet, status: c.status, paidOn: c.paidOn })),
          unpaidAgentCents: mc.filter((c) => c.status !== 'paid').reduce((n, c) => n + c.agentNetCents, 0),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const pending = links.filter((l) => l.status === 'pending').map((l) => ({ linkId: l.id, email: l.invited_email, invitedAt: l.invited_at }));
    return NextResponse.json({ agents, pending });
  } catch (error) {
    return oversightError(error, 'load your agents');
  }
}
