import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { agentLabels, assertBrokerageOwner, listOwnerLinks, loadOversightDeals, productionByMonth } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { toCsv } from '@/lib/contactsCrm';

// CSV of production for the brokerage: one row per agent per month with the closed deals and sales volume. Owner only, and only
// agents with an active link. ?year=2026 limits it to one calendar year. Nothing private to the agent (no clients, no fees).
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const yearParam = request.nextUrl.searchParams.get('year') ?? '';
    const year = /^\d{4}$/.test(yearParam) ? yearParam : undefined;
    const links = await listOwnerLinks(user.id);
    const ids = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    const [labels, deals] = await Promise.all([agentLabels(ids), loadOversightDeals(ids, todayIso())]);
    const rows = productionByMonth(deals, year);
    const csv = toCsv(
      ['Month', 'Agent', 'Email', 'Closed deals', 'Sales volume'],
      rows.map((r) => [r.month, labels.get(r.agentId)?.name ?? 'Agent', labels.get(r.agentId)?.email ?? '', r.closedDeals, Math.round(r.volume * 100) / 100])
    );
    return new NextResponse(`﻿${csv}`, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="production-by-agent-${year ?? 'all-time'}.csv"`, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return oversightError(error, 'export production');
  }
}
