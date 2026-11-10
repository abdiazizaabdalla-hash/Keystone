import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { automationError, DEFAULT_SETTINGS, requireAutomationUser, requireOwnedScope } from '@/lib/automation/server';
import { progressFor } from '@/lib/automation/instances';
import { outboxOnly } from '@/lib/dealEmail';

// GET ?transactionId|listingId: the automations running on one deal or listing the caller owns, with every step's state (done,
// waiting for approval, scheduled for a date, held, skipped, not done and why), plus the file's assistant mode.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const q = request.nextUrl.searchParams;
    const scope = await requireOwnedScope(user.id, { transactionId: q.get('transactionId'), listingId: q.get('listingId') });
    const col = scope.transactionId ? 'transaction_id' : 'listing_id';
    const id = (scope.transactionId ?? scope.listingId)!;
    const [automations, { data: settings }, { data: control }] = await Promise.all([
      progressFor(user.id, scope),
      supabaseServer.from('automation_settings').select('mode').eq(col, id).eq('owner_user_id', user.id).maybeSingle(),
      supabaseServer.from('automation_account_controls').select('paused').eq('owner_user_id', user.id).maybeSingle(),
    ]);
    return NextResponse.json({ automations, mode: (settings?.mode as string | undefined) ?? DEFAULT_SETTINGS.mode, paused: control?.paused === true, outboxOnly: outboxOnly() });
  } catch (error) {
    return automationError(error, 'load the automation progress');
  }
}
