import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { agentLabels, listOwnerLinks, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { compareAgents, lastMonths, monthlySeries, percentChange, totalsOf } from '@/lib/oversightTrends';

// Trends for the brokerage owner. ?months=12 (6, 12 or 24): closed deals and volume by month, brokerage-wide and for any one agent
// (?agent=id). ?period=3 (1, 3, 6 or 12): each agent's last period against the period before. Only agents with an active link.
const pick = (value: string | null, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);

export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    const q = request.nextUrl.searchParams;
    const months = pick(q.get('months'), [6, 12, 24], 12);
    const period = pick(q.get('period'), [1, 3, 6, 12], 3);
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const ids = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    const [labels, deals] = await Promise.all([agentLabels(ids), loadOversightDeals(ids, today)]);
    const agentParam = q.get('agent');
    const agentId = agentParam && ids.includes(agentParam) ? agentParam : undefined;

    const comparison = compareAgents(deals, ids, today, period).map((r) => ({
      ...r,
      name: labels.get(r.agentId)?.name ?? 'Agent',
      volumeChange: percentChange(r.volume, r.prevVolume),
      closedChange: percentChange(r.closedDeals, r.prevClosedDeals),
    }));
    const t = totalsOf(comparison);
    return NextResponse.json({
      months,
      period,
      series: monthlySeries(deals, lastMonths(today, months), today, agentId),
      agentId: agentId ?? null,
      agents: ids.map((id) => ({ id, name: labels.get(id)?.name ?? 'Agent' })).sort((a, b) => a.name.localeCompare(b.name)),
      comparison,
      totals: { ...t, volumeChange: percentChange(t.volume, t.prevVolume), closedChange: percentChange(t.closedDeals, t.prevClosedDeals) },
    });
  } catch (error) {
    return oversightError(error, 'load trends');
  }
}
