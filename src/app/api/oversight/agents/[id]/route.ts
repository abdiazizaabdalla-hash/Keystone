import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { AGENT_FOCUS, AGENT_VOLUME } from '@/lib/accountType';
import { CLOSED_STAGE, isOpenListing, loadOversightDeals, loadOversightListings, overseesAgent, productionFor } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { capInfoFor, termsFromLink, viewOf, type CommissionRow } from '@/lib/commissions';
import type { SplitType } from '@/lib/commissionMath';
import { getAgentListingRows } from '@/lib/agentListings';

// One agent in the brokerage, in full: who they are, their base commission, production, open and closed deals with the next
// step on each, and their commissions. [id] is the agent's user id. Only for an owner whose active link is with that agent.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    if (!(await overseesAgent(user.id, id))) throw new AuthError('Not found', 404);
    const today = todayIso();

    const [{ data: link }, authRes, { data: agentRow }, deals, listings, { data: commissionRows }] = await Promise.all([
      supabaseServer.from('brokerage_links').select('*').eq('owner_user_id', user.id).eq('agent_user_id', id).eq('status', 'active').maybeSingle(),
      supabaseServer.auth.admin.getUserById(id),
      supabaseServer.from('agents').select('name, phone, brokerage').eq('tc_user_id', id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      loadOversightDeals([id], today),
      loadOversightListings([id], today),
      supabaseServer.from('deal_commissions').select('*').eq('owner_user_id', user.id).eq('agent_user_id', id).order('proposed_at', { ascending: false }).limit(200),
    ]);
    const u = authRes.data.user;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    const prof = (meta.agent_profile ?? {}) as { focus?: string[]; dealsPerYear?: string | null; license?: string | null };

    // The states they chose at setup (their "My states" pins). Absent where templates are not set up.
    let states: string[] = [];
    const pins = await supabaseServer.from('template_pins').select('ref').eq('owner_user_id', id).eq('kind', 'folder');
    if (!pins.error) states = (pins.data ?? []).map((r) => String(r.ref)).sort();

    const open = deals.filter((d) => d.status !== CLOSED_STAGE);
    const closed = deals.filter((d) => d.status === CLOSED_STAGE).slice(0, 15);
    const production = productionFor(deals, today);

    // Listings are counted on their own (never inside the deal numbers): what is on the market and at what list price.
    const openListings = listings.filter((l) => isOpenListing(l.status));
    const listingProduction = {
      activeListings: openListings.length,
      listedVolume: openListings.reduce((n, l) => n + (Number(l.list_price) || 0), 0),
    };

    // What the agent also works on that a coordinator runs for them (shared into their workspace). Shown apart from their own
    // work and not counted in the numbers above, because those belong to the coordinator's account.
    const coordinatorRun: { kind: 'deal' | 'listing'; id: string; property: string | null; status: string | null; price: number | null; coordinator: string }[] = [];
    try {
      const nameOf = async (uid: string) => {
        const { data: cu } = await supabaseServer.auth.admin.getUserById(uid);
        return (cu.user?.user_metadata?.full_name as string | undefined)?.trim() || cu.user?.email || 'A coordinator';
      };
      for (const l of await getAgentListingRows(u?.email)) {
        if (l.tc_user_id === id || l.status === 'converted') continue;
        coordinatorRun.push({ kind: 'listing', id: l.id as string, property: (l.property_address as string | null) ?? null, status: (l.status as string | null) ?? null, price: l.list_price ? Number(l.list_price) : null, coordinator: await nameOf(l.tc_user_id as string) });
      }
      const { data: shared } = await supabaseServer.from('transaction_agents').select('transaction_id').eq('agent_user_id', id).limit(200);
      const sharedIds = (shared ?? []).map((r) => r.transaction_id as string);
      if (sharedIds.length) {
        const { data: txs } = await supabaseServer.from('transactions').select('id, tc_user_id, property_address, status, purchase_price').in('id', sharedIds).neq('tc_user_id', id);
        for (const t of txs ?? []) {
          coordinatorRun.push({ kind: 'deal', id: t.id as string, property: (t.property_address as string | null) ?? null, status: (t.status as string | null) ?? null, price: t.purchase_price ? Number(t.purchase_price) : null, coordinator: await nameOf(t.tc_user_id as string) });
        }
      }
    } catch (e) {
      console.error('coordinator-run work unavailable (ignored):', e);
    }

    const terms = termsFromLink(link);
    const cap = terms.cap ? await capInfoFor(user.id, id, terms, today) : null;
    const rows = ((commissionRows ?? []) as CommissionRow[]);
    const commissions = rows.map((r) => ({ ...viewOf(r), property: deals.find((d) => d.id === r.transaction_id)?.property_address ?? null }));
    const live = commissions.filter((c) => c.status !== 'void' && c.status !== 'estimate');
    const year = today.slice(0, 4);
    const ytd = live.filter((c) => c.status === 'paid' && (c.paidOn ?? '').startsWith(year));

    return NextResponse.json({
      agent: {
        id,
        linkId: link?.id ?? null,
        name: (typeof meta.full_name === 'string' && meta.full_name.trim()) || agentRow?.name || u?.email || 'Agent',
        email: u?.email ?? null,
        phone: agentRow?.phone ?? null,
        license: prof.license ?? null,
        focus: (prof.focus ?? []).map((f) => AGENT_FOCUS.find((o) => o.id === f)?.label ?? f),
        dealsPerYear: AGENT_VOLUME.find((o) => o.id === prof.dealsPerYear)?.label ?? null,
        states,
        joinedAt: link?.responded_at ?? null,
        baseFees: terms.fees.map((f) => ({ label: f.label, amount: f.amount })),
        baseCap: terms.cap ? { amount: terms.cap.capCents / 100, reset: terms.cap.reset, start: (link?.cap_start as string | null) ?? null } : null,
        cap,
        baseRate: terms.commission,
        baseCommission: link?.default_split_type && link.default_split_value !== null ? { type: link.default_split_type as SplitType, value: Number(link.default_split_value) } : null,
      },
      production,
      listingProduction,
      coordinatorRun,
      openDeals: open,
      closedDeals: closed,
      openListings: listings.filter((l) => isOpenListing(l.status)),
      closedListings: listings.filter((l) => !isOpenListing(l.status)).slice(0, 15),
      commissions,
      commissionTotals: {
        gross: live.reduce((n, c) => n + (c.gross ?? 0), 0),
        agentNet: live.reduce((n, c) => n + (c.agentNet ?? 0), 0),
        brokerageNet: live.reduce((n, c) => n + (c.brokerageNet ?? 0), 0),
        unpaidCount: live.filter((c) => c.status !== 'paid').length,
        paidThisYear: ytd.reduce((n, c) => n + (c.agentNet ?? 0), 0),
      },
    });
  } catch (error) {
    return oversightError(error, 'load that agent');
  }
}
