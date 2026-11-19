import { NextRequest, NextResponse } from 'next/server';
import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { CLOSED_STAGE, agentLabels, closedWithoutCommission, closingSoon, isOpenListing, listOwnerLinks, loadOversightDeals, loadOversightListings, productionFor } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';

// Everything the brokerage owner's dashboard shows, in one request: the agents, the pipeline, what needs attention,
// closings coming up and where commissions stand. Counts and names only; nothing private to the agents.
export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const activeLinks = links.filter((l) => l.status === 'active' && l.agent_user_id);
    const ids = activeLinks.map((l) => l.agent_user_id as string);
    const [labels, deals, listings, { data: commissionRows }, { count: unread }] = await Promise.all([
      agentLabels(ids),
      loadOversightDeals(ids, today),
      loadOversightListings(ids, today),
      supabaseServer.from('deal_commissions').select('transaction_id, agent_user_id, status, change_note, agent_net_cents, gross_cents, estimated_gross_cents').eq('owner_user_id', user.id).limit(2000),
      supabaseServer.from('brokerage_messages').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id).neq('sender_id', user.id).is('read_at', null),
    ]);

    const nameOf = (id: string) => labels.get(id)?.name ?? 'Agent';
    const openDeals = deals.filter((d) => d.status !== CLOSED_STAGE);
    const openListings = listings.filter((l) => isOpenListing(l.status));
    const production = productionFor(deals, today);

    const rows = commissionRows ?? [];
    // An estimate on an open deal is an invoice the agent sent early; it has no amounts and waits for the closing documents.
    const live = rows.filter((r) => r.status !== 'void');
    const withCommission = new Set(live.map((r) => r.transaction_id as string));
    // An estimate has no amount to pay yet, so it is not 'owed'; it is something the owner still has to confirm.
    const unpaid = live.filter((r) => r.status !== 'paid' && r.status !== 'estimate');
    // Closed deals whose estimate is waiting for the actual commission. Includes deals a coordinator runs that an agent was added to, which are not in the agents' own deals above.
    const estimates = live.filter((r) => r.status === 'estimate');
    const estimateDeals = new Map<string, { address: string | null; status: string | null; price: number | null }>();
    for (let i = 0; i < estimates.length; i += 80) {
      const { data } = await supabaseServer.from('transactions').select('id, property_address, status, purchase_price').in('id', estimates.slice(i, i + 80).map((r) => r.transaction_id as string));
      for (const t of data ?? []) estimateDeals.set(t.id as string, { address: t.property_address as string | null, status: t.status as string | null, price: t.purchase_price ? Number(t.purchase_price) : null });
    }
    const confirmDeals = estimates
      .filter((r) => estimateDeals.get(r.transaction_id as string)?.status === CLOSED_STAGE)
      .map((r) => {
        const d = estimateDeals.get(r.transaction_id as string)!;
        return { id: r.transaction_id as string, address: d.address, salePrice: d.price, estimatedGrossCents: r.estimated_gross_cents === null || r.estimated_gross_cents === undefined ? null : Number(r.estimated_gross_cents), agent: { id: r.agent_user_id as string, name: nameOf(r.agent_user_id as string) } };
      });
    const commissions = {
      changeRequested: live.filter((r) => r.status === 'change_requested' && r.change_note).length,
      needsConfirm: confirmDeals.length,
      needsApproval: live.filter((r) => r.status === 'change_requested' && !r.change_note).length,
      awaitingAgent: live.filter((r) => r.status === 'proposed').length,
      readyToPay: live.filter((r) => r.status === 'accepted').length,
      unpaidCount: unpaid.length,
      unpaidAgentCents: unpaid.reduce((n, r) => n + Number(r.agent_net_cents ?? 0), 0),
      // What is already settled, so a brokerage that has paid everyone sees that instead of a row of zeros.
      paidCount: live.filter((r) => r.status === 'paid').length,
      paidAgentCents: live.filter((r) => r.status === 'paid').reduce((n, r) => n + Number(r.agent_net_cents ?? 0), 0),
      confirmedGrossCents: live.filter((r) => r.status !== 'estimate').reduce((n, r) => n + Number(r.gross_cents ?? 0), 0),
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
      confirmDeals,
      unreadMessages: unread ?? 0,
      agents,
    });
  } catch (error) {
    return oversightError(error, 'load your brokerage home');
  }
}
