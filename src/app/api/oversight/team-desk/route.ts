import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { CLOSED_STAGE, agentLabels, loadOversightDeals, rosterStats } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { resolveOversightActor } from '@/lib/brokerageAdminsServer';
import { rosterFor } from '@/lib/oversightRoster';
import { closingFlags, stalledFlags } from '@/lib/brokerageAutomationRules';

// A TC team owner's workload view: for each coordinator, open files, late steps and closings this week, and the files that need the owner
// (late steps, closing soon, gone quiet). Status only: addresses and stages, never prices, client names, documents or messages.
export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner } = await resolveOversightActor(caller, 'view');
    const today = todayIso();
    const roster = await rosterFor(owner.id);
    const [labels, deals] = await Promise.all([agentLabels(roster.userIds), loadOversightDeals(roster.userIds, today)]);
    const nameOf = (id: string) => labels.get(id)?.name ?? 'Coordinator';

    const members = roster.userIds.map((id) => ({ id, name: nameOf(id), ...rosterStats(deals.filter((d) => d.tc_user_id === id), [], today) })).sort((a, b) => b.lateTasks - a.lateTasks || b.closingThisWeek - a.closingThisWeek || a.name.localeCompare(b.name));

    const open = deals.filter((d) => d.status !== CLOSED_STAGE);
    const stalled = stalledFlags(open, today, 5);
    const attention = [
      ...open.filter((d) => d.health.overdueTasks > 0).map((d) => ({ dealId: d.id, address: d.property_address || 'A deal', member: nameOf(d.tc_user_id), reason: `${d.health.overdueTasks} step${d.health.overdueTasks === 1 ? '' : 's'} overdue`, tone: 'late' as const })),
      ...closingFlags(open, today, 7).map((f) => ({ dealId: f.dealId as string, address: f.address, member: nameOf(f.agentId), reason: f.reason, tone: 'closing' as const })),
      ...stalled.map((f) => ({ dealId: f.dealId as string, address: f.address, member: nameOf(f.agentId), reason: f.reason, tone: 'quiet' as const })),
    ].slice(0, 40);

    return NextResponse.json({
      mode: roster.mode,
      members,
      attention,
      totals: {
        openDeals: open.length,
        lateDeals: open.filter((d) => d.health.overdueTasks > 0).length,
        closingThisWeek: closingFlags(open, today, 7).length,
        quiet: stalled.length,
      },
    });
  } catch (error) {
    return oversightError(error, 'load the team workload');
  }
}
