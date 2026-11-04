import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { CLOSED_STAGE, agentLabels, assertBrokerageOwner, closedWithoutCommission, closingSoon, isOpenListing, listOwnerLinks, loadOversightDeals, loadOversightListings, productionFor } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';

// Everything the brokerage owner's dashboard shows, in one request: the agents, the pipeline, what needs attention,
// closings coming up and where commissions stand. Counts and names only; nothing private to the agents.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const activeLinks = links.filter((l) => l.status === 'active' && l.agent_user_id);
    const ids = activeLinks.map((l) => l.agent_user_id as string);
    const [labels, deals, listings, { data: commissionRows }, { count: unread }] = await Promise.all([
      agentLabels(ids),
      loadOversightDeals(ids, today),
      loadOversightListings(ids, today),
      supabaseServer.from('deal_commissions').select('transaction_id, status, change_note, agent_net_cents').eq('owner_user_id', user.id).limit(2000),
      supabaseServer.from('brokerage_messages').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id).neq('sender_id', user.id).is('read_at', null),
    ]);

    const nameOf = (id: string) => labels.get(id)?.name ?? 'Agent';
    const openDeals = deals.filter((d) => d.status !== CLOSED_STAGE);
    const openListings = listings.filter((l) => isOpenListing(l.status));
    const production = productionFor(deals, today);

    const rows = commissionRows ?? [];
    const live = rows.filter((r) => r.status !== 'void');
    const withCommission = new Set(live.map((r) => r.transaction_id as string));
    const closedIds = new Set(deals.filter((d) => d.status === CLOSED_STAGE).map((d) => d.id));
    // An estimate has no amount to pay yet, so it is not 'owed'; it is something the owner still has to confirm.
    const unpaid = live.filter((r) => r.status !== 'paid' && r.status !== 'estimate');
    const commissions = {
      changeRequested: live.filter((r) => r.status === 'change_requested' && r.change_note).length,
      needsConfirm: live.filter((r) => r.status === 'estimate' && closedIds.has(r.transaction_id as string)).length,
      needsApproval: live.filter((r) => r.status === 'change_requested' && !r.change_note).length,
      awaitingAgent: live.filter((r) => r.status === 'proposed').length,
      readyToPay: live.filter((r) => r.status === 'accepted').length,
      unpaidCount: unpaid.length,
      unpaidAgentCents: unpaid.reduce((n, r) => n + Number(r.agent_net_cents ?? 0), 0),
      closedWithoutStatement: closedWithoutCommission(deals, withCommission, today).length,
    };

    const dealRow = (d: (typeof deals)[number]) => ({ id: d.id, address: d.property_address, status: d.status, agent: { id: d.tc_user_id, name: nameOf(d.tc_user_id) }, closingDate: d.closing_date, flags: d.health.flags, nextStep: d.nextStep });
    const listingRow = (l: (typeof listings)[number]) => ({ id: l.id, address: l.property_address, status: l.status, agent: { id: l.tc_user_id, name: nameOf(l.tc_user_id) }, flags: l.health.flags, nextStep: l.nextStep });

    const agents = activeLinks
      .map((l) => {
        const id = l.agent_user_id as string;
        const mine = deals.filter((d) => d.tc_user_id === id);
        return {
          id,
          name: nameOf(id),
          openDeals: mine.filter((d) => d.status !== CLOSED_STAGE).length,
          openListings: openListings.filter((x) => x.tc_user_id === id).length,
          needsAttention: mine.filter((d) => d.health.flags.length > 0).length + openListings.filter((x) => x.tc_user_id === id && x.health.flags.length > 0).length,
          closedThisYear: productionFor(mine, today).closedThisYear,
          baseCommission: l.default_split_type && l.default_split_value !== null && l.default_split_value !== undefined ? { type: l.default_split_type, value: Number(l.default_split_value) } : null,
        };
      })
      .sort((a, b) => b.needsAttention - a.needsAttention || b.openDeals - a.openDeals || a.name.localeCompare(b.name));

    return NextResponse.json({
      totals: {
        agents: activeLinks.length,
        pendingInvites: links.filter((l) => l.status === 'pending').length,
        openDeals: openDeals.length,
        pipelineVolume: production.pipelineVolume,
        openListings: openListings.length,
        listPriceVolume: openListings.reduce((n, l) => n + (Number(l.list_price) || 0), 0),
        closedThisYear: production.closedThisYear,
        volumeThisYear: production.volumeThisYear,
        closedLast30Days: production.closedLast30Days,
        needsAttention: openDeals.filter((d) => d.health.flags.length > 0).length + openListings.filter((l) => l.health.flags.length > 0).length,
      },
      attentionDeals: openDeals.filter((d) => d.health.flags.length > 0).sort((a, b) => b.health.flags.length - a.health.flags.length).slice(0, 6).map(dealRow),
      attentionListings: openListings.filter((l) => l.health.flags.length > 0).slice(0, 6).map(listingRow),
      closingSoon: closingSoon(openDeals, today, 30).slice(0, 8).map(dealRow),
      commissions,
      unreadMessages: unread ?? 0,
      agents,
    });
  } catch (error) {
    return oversightError(error, 'load your brokerage home');
  }
}
