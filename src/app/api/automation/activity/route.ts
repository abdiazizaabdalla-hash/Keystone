import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { automationError, DEFAULT_SETTINGS, requireAutomationUser, requireOwnedScope } from '@/lib/automation/server';
import { kindLabel, refusalText, summarizeAction } from '@/lib/automation/describe';
import { outboxOnly } from '@/lib/dealEmail';

// GET ?transactionId=... or ?listingId=...: the assistant setting for one deal or listing, whether the account is paused, and
// what Relay did or proposed there (newest first), with any draft waiting for a decision.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const q = request.nextUrl.searchParams;
    const scope = await requireOwnedScope(user.id, { transactionId: q.get('transactionId'), listingId: q.get('listingId') });
    const col = scope.transactionId ? 'transaction_id' : 'listing_id';
    const id = (scope.transactionId ?? scope.listingId)!;

    const [{ data: settings }, { data: control }, { data: actions, error }] = await Promise.all([
      supabaseServer.from('automation_settings').select('mode, follow_up_days, quiet_start_hour, quiet_end_hour, time_zone, daily_send_cap').eq(col, id).eq('owner_user_id', user.id).maybeSingle(),
      supabaseServer.from('automation_account_controls').select('paused').eq('owner_user_id', user.id).maybeSingle(),
      supabaseServer.from('automation_actions').select('id, kind, status, inputs, result, refusal_reason, created_at, executed_at').eq(col, id).eq('owner_user_id', user.id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (error) throw error;
    const ids = (actions ?? []).map((a) => a.id as string);
    const { data: approvals } = ids.length ? await supabaseServer.from('automation_approvals').select('action_id, status, draft, edited').in('action_id', ids) : { data: [] };
    const byAction = new Map((approvals ?? []).map((a) => [a.action_id as string, a]));

    return NextResponse.json({
      outboxOnly: outboxOnly(),
      paused: control?.paused === true,
      settings: settings ?? DEFAULT_SETTINGS,
      hasSettings: Boolean(settings),
      activity: (actions ?? []).map((a) => {
        const inputs = (a.inputs ?? {}) as Record<string, unknown>;
        const approval = byAction.get(a.id as string);
        return {
          id: a.id,
          kind: a.kind,
          label: kindLabel(a.kind as string),
          summary: summarizeAction(a.kind as string, inputs),
          status: a.status,
          reason: refusalText(a.refusal_reason as string | null),
          createdAt: a.created_at,
          executedAt: a.executed_at,
          // Only a draft still waiting for a person carries its editable content.
          draft: a.status === 'awaiting_approval' ? { inputs: approval?.draft ?? inputs } : null,
        };
      }),
    });
  } catch (error) {
    return automationError(error, 'load the assistant activity');
  }
}
