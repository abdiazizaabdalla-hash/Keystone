import { NextRequest, NextResponse } from 'next/server';
import { automationError, requireAutomationUser, requireOwnedScope } from '@/lib/automation/server';
import { history } from '@/lib/automation/instances';
import { kindLabel, refusalText, summarizeAction } from '@/lib/automation/describe';

// GET ?templateId | ?transactionId | ?listingId (or none for everything): what saved automations did, newest first,
// with successes, failures and what is still pending. Only the caller's own runs.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const q = request.nextUrl.searchParams;
    const scope = q.get('transactionId') || q.get('listingId') ? await requireOwnedScope(user.id, { transactionId: q.get('transactionId'), listingId: q.get('listingId') }) : null;
    const rows = await history(user.id, { templateId: q.get('templateId') || undefined, transactionId: scope?.transactionId ?? undefined, listingId: scope?.listingId ?? undefined });
    return NextResponse.json({
      runs: rows.map((r) => ({
        id: r.id, kind: r.kind, label: kindLabel(r.kind as string), summary: summarizeAction(r.kind as string, (r.inputs ?? {}) as Record<string, unknown>),
        status: r.status, reason: refusalText(r.refusal_reason as string | null), createdAt: r.created_at, executedAt: r.executed_at,
        transactionId: r.transaction_id, listingId: r.listing_id, instanceId: r.instance_id,
      })),
    });
  } catch (error) {
    return automationError(error, 'load the history');
  }
}
