import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser, requireOwnedScope } from '@/lib/automation/server';

// PUT { transactionId | listingId, mode: 'off'|'draft'|'auto', followUpDays?, dailySendCap?, quietStartHour?, quietEndHour?, timeZone? }
// Saves the assistant setting for one deal or listing the caller owns. Select then insert/update: the table is unique per deal
// through a partial index, which an on-conflict upsert cannot use.
const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    const scope = await requireOwnedScope(user.id, body);
    if (body.mode !== 'off' && body.mode !== 'draft' && body.mode !== 'auto') throw new AuthError('Mode must be off, draft or auto', 400);

    const fields: Record<string, unknown> = { mode: body.mode, updated_at: new Date().toISOString() };
    const followUp = int(body.followUpDays, 1, 30);
    const cap = int(body.dailySendCap, 0, 200);
    const qs = int(body.quietStartHour, 0, 23);
    const qe = int(body.quietEndHour, 0, 23);
    if (followUp !== undefined) fields.follow_up_days = followUp;
    if (cap !== undefined) fields.daily_send_cap = cap;
    if (qs !== undefined) fields.quiet_start_hour = qs;
    if (qe !== undefined) fields.quiet_end_hour = qe;
    if (typeof body.timeZone === 'string') {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: body.timeZone });
        fields.time_zone = body.timeZone;
      } catch {
        throw new AuthError('That time zone is not recognised', 400);
      }
    }

    const col = scope.transactionId ? 'transaction_id' : 'listing_id';
    const id = (scope.transactionId ?? scope.listingId)!;
    const { data: existing, error: readError } = await supabaseServer.from('automation_settings').select('id').eq(col, id).maybeSingle();
    if (readError) throw readError;
    const { error } = existing
      ? await supabaseServer.from('automation_settings').update(fields).eq('id', existing.id).eq('owner_user_id', user.id)
      : await supabaseServer.from('automation_settings').insert({ ...fields, owner_user_id: user.id, [col]: id });
    if (error) throw error;
    return NextResponse.json({ ok: true, mode: body.mode });
  } catch (error) {
    return automationError(error, 'save the assistant setting');
  }
}
