import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { CLOSED_STAGE, activeAgentIds, agentLabels, assertBrokerageOwner, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';

// Every deal of the agents who joined this brokerage, with what needs attention first.
// Optional ?agent=<user id> and ?show=open|closed|all (default open).
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const ids = await activeAgentIds(user.id);
    const only = request.nextUrl.searchParams.get('agent');
    const show = request.nextUrl.searchParams.get('show') ?? 'open';
    const scope = only ? ids.filter((i) => i === only) : ids;
    const labels = await agentLabels(scope);
    const deals = (await loadOversightDeals(scope, todayIso()))
      .filter((d) => (show === 'all' ? true : show === 'closed' ? d.status === CLOSED_STAGE : d.status !== CLOSED_STAGE))
      .map((d) => ({ ...d, agent: labels.get(d.tc_user_id) ?? { id: d.tc_user_id, name: 'Agent', email: null } }))
      .sort((a, b) => b.health.flags.length - a.health.flags.length || (a.health.nextDue ?? '9999').localeCompare(b.health.nextDue ?? '9999'));
    return NextResponse.json(deals);
  } catch (error) {
    return oversightError(error, 'load the deals');
  }
}
