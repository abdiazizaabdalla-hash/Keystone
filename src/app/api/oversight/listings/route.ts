import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { activeAgentIds, agentLabels, assertBrokerageOwner, isOpenListing, loadOversightListings } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';

// Every listing of the agents who joined this brokerage, with what needs attention first.
// Optional ?agent=<user id> and ?show=open|closed|all (default open). Seller details and offers are not part of this.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const ids = await activeAgentIds(user.id);
    const only = request.nextUrl.searchParams.get('agent');
    const show = request.nextUrl.searchParams.get('show') ?? 'open';
    const scope = only ? ids.filter((i) => i === only) : ids;
    const labels = await agentLabels(scope);
    const listings = (await loadOversightListings(scope, todayIso()))
      .filter((l) => (show === 'all' ? true : show === 'closed' ? !isOpenListing(l.status) : isOpenListing(l.status)))
      .map((l) => ({ ...l, agent: labels.get(l.tc_user_id) ?? { id: l.tc_user_id, name: 'Agent', email: null } }))
      .sort((a, b) => b.health.flags.length - a.health.flags.length || (a.health.nextDue ?? '9999').localeCompare(b.health.nextDue ?? '9999'));
    return NextResponse.json(listings);
  } catch (error) {
    return oversightError(error, 'load the listings');
  }
}
