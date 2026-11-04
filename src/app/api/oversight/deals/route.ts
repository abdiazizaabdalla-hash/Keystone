import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { CLOSED_STAGE, activeAgentIds, agentLabels, assertBrokerageOwner, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { supabaseServer } from '@/lib/supabase';

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
    const loaded = await loadOversightDeals(scope, todayIso());
    // Where each deal's commission invoice stands, so the list shows what the brokerage still has to do.
    const commissionOf = new Map<string, { status: string; submitted: boolean; statementNumber: string }>();
    for (let i = 0; i < loaded.length; i += 80) {
      const { data } = await supabaseServer.from('deal_commissions').select('transaction_id, status, change_note, statement_number').eq('owner_user_id', user.id).in('transaction_id', loaded.slice(i, i + 80).map((d) => d.id));
      for (const c of data ?? []) if (c.status !== 'void') commissionOf.set(c.transaction_id as string, { status: c.status as string, submitted: c.status === 'change_requested' && !c.change_note, statementNumber: c.statement_number as string });
    }
    const deals = loaded
      .filter((d) => (show === 'all' ? true : show === 'closed' ? d.status === CLOSED_STAGE : d.status !== CLOSED_STAGE))
      .map((d) => ({ ...d, commission: commissionOf.get(d.id) ?? null, agent: labels.get(d.tc_user_id) ?? { id: d.tc_user_id, name: 'Agent', email: null } }))
      .sort((a, b) => b.health.flags.length - a.health.flags.length || (a.health.nextDue ?? '9999').localeCompare(b.health.nextDue ?? '9999'));
    return NextResponse.json(deals);
  } catch (error) {
    return oversightError(error, 'load the deals');
  }
}
