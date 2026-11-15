import { resolveOversightActor } from '@/lib/brokerageAdminsServer';
import { rosterFor } from '@/lib/oversightRoster';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { agentLabels, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { compareAgents, lastMonths, monthlySeries, percentChange, periodKpis, pipelineNow, totalsOf } from '@/lib/oversightTrends';

// Trends for the brokerage owner. ?months=12 (6, 12 or 24): closed deals and volume by month, brokerage-wide and for any one agent
// (?agent=id). ?period=3 (1, 3, 6 or 12): each agent's last period against the period before. Only agents with an active link.
const pick = (value: string | null, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);

export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveOversightActor(caller, 'view');
    const q = request.nextUrl.searchParams;
    const months = pick(q.get('months'), [6, 12, 24], 12);
    const period = pick(q.get('period'), [1, 3, 6, 12], 3);
    const today = todayIso();
    const roster = await rosterFor(user.id);
    const ids = roster.userIds;
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
    // A TC team owner sees counts and status only, so every money figure is left out for a team.
    const showMoney = roster.mode === 'brokerage';
    const noMoney = <T extends { volume: number }>(r: T) => (showMoney ? r : { ...r, volume: 0 });
    const kp = periodKpis(deals, today, period);
    return NextResponse.json({
      mode: roster.mode,
      showMoney,
      months,
      period,
      series: monthlySeries(deals, lastMonths(today, months), today, agentId).map(noMoney),
      agentId: agentId ?? null,
      agents: ids.map((id) => ({ id, name: labels.get(id)?.name ?? 'Agent' })).sort((a, b) => a.name.localeCompare(b.name)),
      comparison: showMoney ? comparison : comparison.map((r) => ({ ...r, volume: 0, prevVolume: 0, volumeChange: null })),
      kpis: showMoney ? kp : { current: { ...kp.current, volume: 0, avgPrice: null }, previous: { ...kp.previous, volume: 0, avgPrice: null } },
      pipeline: showMoney ? pipelineNow(deals, today) : { ...pipelineNow(deals, today), openVolume: 0, closingNext30Volume: 0 },
      totals: showMoney ? { ...t, volumeChange: percentChange(t.volume, t.prevVolume), closedChange: percentChange(t.closedDeals, t.prevClosedDeals) } : { ...t, volume: 0, prevVolume: 0, volumeChange: null, closedChange: percentChange(t.closedDeals, t.prevClosedDeals) },
    });
  } catch (error) {
    return oversightError(error, 'load trends');
  }
}
