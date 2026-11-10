import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser, requireOwnedScope } from '@/lib/automation/server';
import { acknowledge, alertsFor } from '@/lib/automation/alerts';

// GET ?transactionId|listingId: the banners for one deal or listing the caller owns (drafts waiting, reminders, emails that did not go).
// POST { actionId } or { transactionId | listingId, all: true }: acknowledges reminders and problems so they disappear.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const q = request.nextUrl.searchParams;
    const scope = await requireOwnedScope(user.id, { transactionId: q.get('transactionId'), listingId: q.get('listingId') });
    const alerts = await alertsFor(user.id, scope);
    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    return automationError(error, 'load the automation alerts');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.actionId === 'string' && body.actionId) {
      const n = await acknowledge(user.id, { actionId: body.actionId });
      if (n === 0) throw new AuthError('Nothing to acknowledge', 404);
      return NextResponse.json({ acknowledged: n });
    }
    if (body.all === true) {
      const scope = await requireOwnedScope(user.id, body);
      return NextResponse.json({ acknowledged: await acknowledge(user.id, scope) });
    }
    throw new AuthError('Give an actionId, or all: true with a transaction or listing', 400);
  } catch (error) {
    return automationError(error, 'acknowledge the alert');
  }
}
