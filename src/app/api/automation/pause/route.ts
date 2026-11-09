import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';

// GET: is automation paused for this account? PUT { paused: boolean }: the account-wide kill switch. While paused, nothing
// automatic runs and any approval is refused when someone tries to approve it.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const { data } = await supabaseServer.from('automation_account_controls').select('paused').eq('owner_user_id', user.id).maybeSingle();
    return NextResponse.json({ paused: data?.paused === true });
  } catch (error) {
    return automationError(error, 'load the pause switch');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.paused !== 'boolean') throw new AuthError('paused must be true or false', 400);
    const now = new Date().toISOString();
    const { error } = await supabaseServer.from('automation_account_controls').upsert({ owner_user_id: user.id, paused: body.paused, paused_at: body.paused ? now : null, paused_by: body.paused ? user.id : null, updated_at: now }, { onConflict: 'owner_user_id' });
    if (error) throw error;
    return NextResponse.json({ paused: body.paused });
  } catch (error) {
    return automationError(error, 'change the pause switch');
  }
}
