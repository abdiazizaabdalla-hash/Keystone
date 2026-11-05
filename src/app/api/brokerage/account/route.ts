import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { brokerageOn, assertBrokerageOwner } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { getAccount, requestUpgrade } from '@/lib/brokerageAccount';
import { PilotError, accessFor } from '@/lib/brokeragePilot';

// The brokerage owner's own account: where the pilot stands, how many seats, and a way to ask for the upgrade.
//   GET                          -> { account: null } when not under a pilot or plan yet, else the status below
//   POST { action: 'request_upgrade' }
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    assertBrokerageOwner(user);
    const account = await getAccount(user.id);
    if (!account) return NextResponse.json({ account: null });
    const today = new Date().toISOString().slice(0, 10);
    const access = accessFor(account, today);
    const { data: links } = await supabaseServer.from('brokerage_links').select('status').eq('owner_user_id', user.id).in('status', ['active', 'pending']);
    const active = (links ?? []).filter((l) => l.status === 'active').length;
    const pending = (links ?? []).length - active;
    return NextResponse.json({
      account: {
        status: access.status,
        tier: account.tier,
        endsOn: account.pilot_ends_on,
        daysLeft: access.daysLeft,
        canManage: access.canManage,
        canRequestUpgrade: access.canRequestUpgrade,
        upgradeRequested: Boolean(account.upgrade_requested_at),
        seats: { active, pending, limit: access.seatLimit },
      },
    });
  } catch (error) {
    return oversightError(error, 'load your brokerage account');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    assertBrokerageOwner(user);
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action !== 'request_upgrade') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    const label = (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) || user.email || 'A brokerage';
    await requestUpgrade(user.id, label);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PilotError) return NextResponse.json({ error: error.message }, { status: error.status });
    return oversightError(error, 'request the upgrade');
  }
}
