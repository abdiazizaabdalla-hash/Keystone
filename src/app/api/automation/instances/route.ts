import { NextRequest, NextResponse } from 'next/server';
import { automationError, requireAutomationUser, requireOwnedScope } from '@/lib/automation/server';
import { assignTemplates, listInstances } from '@/lib/automation/instances';

// GET ?transactionId|listingId: the automations running on one deal or listing the caller owns.
// POST { transactionId | listingId, templateIds: [] }: applies saved automations to it. Each becomes its own copy.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const q = request.nextUrl.searchParams;
    const scope = await requireOwnedScope(user.id, { transactionId: q.get('transactionId'), listingId: q.get('listingId') });
    return NextResponse.json({ instances: await listInstances(user.id, scope) });
  } catch (error) {
    return automationError(error, 'load the automations on this file');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    const scope = await requireOwnedScope(user.id, body);
    const ids = Array.isArray(body.templateIds) ? body.templateIds.filter((x: unknown): x is string => typeof x === 'string') : [];
    return NextResponse.json(await assignTemplates(user.id, scope, ids));
  } catch (error) {
    return automationError(error, 'apply the automations');
  }
}
