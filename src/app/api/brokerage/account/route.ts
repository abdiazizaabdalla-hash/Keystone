import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { brokerageOn, assertBrokerageOwner } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { getAccount, requestUpgrade, recordExtraSeats } from '@/lib/brokerageAccount';
import { brokerageBillingReady } from '@/lib/stripePrices';
import { validateExtraSeats } from '@/lib/brokerageBilling';
import { findBrokerageSubscription, setExtraAgentsOnSubscription } from '@/lib/brokerageStripe';
import { PilotError, accessFor } from '@/lib/brokeragePilot';
import { BROKERAGE_PRICING, estimatedMonthly, extraAgents } from '@/lib/brokeragePricing';

// The brokerage owner's own account: where the pilot stands, how many seats, and a way to ask for the upgrade.
//   GET                          -> { account: null } when not under a pilot or plan yet, else the status below
//   POST { action: 'request_upgrade' }
//   POST { action: 'set_extra_seats', extraSeats }   buy or drop extra agents on an active Stripe subscription
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    await assertBrokerageOwner(user);
    const account = await getAccount(user.id);
    if (!account) return NextResponse.json({ account: null });
    const today = new Date().toISOString().slice(0, 10);
    const access = accessFor(account, today);
    const { data: links } = await supabaseServer.from('brokerage_links').select('status').eq('owner_user_id', user.id).in('status', ['active', 'pending']);
    const active = (links ?? []).filter((l) => l.status === 'active').length;
    const pending = (links ?? []).length - active;
    // Stripe is asked only for accounts that are already paying, to know whether Manage billing and extra agents apply.
    const subscribed = account.status === 'converted' ? Boolean(await findBrokerageSubscription(user.id).catch(() => null)) : false;
    return NextResponse.json({
      account: {
        billing: { ready: { basic: brokerageBillingReady('basic'), pro: brokerageBillingReady('pro') }, subscribed, extraSeats: account.extra_seats },
        status: access.status,
        tier: account.tier,
        endsOn: account.pilot_ends_on,
        daysLeft: access.daysLeft,
        canManage: access.canManage,
        canRequestUpgrade: access.canRequestUpgrade,
        upgradeRequested: Boolean(account.upgrade_requested_at),
        seats: { active, pending, limit: access.seatLimit },
        // An estimate of the recurring price for the agents on the roster, not a bill: billing is a manual record today.
        pricing: { included: BROKERAGE_PRICING[account.tier].includedAgents, extraAgents: extraAgents(account.tier, active), estimatedMonthly: estimatedMonthly(account.tier, active), billedAutomatically: false },
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
    await assertBrokerageOwner(user);
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action === 'set_extra_seats') {
      const requested = (body as { extraSeats?: unknown }).extraSeats;
      const account = await getAccount(user.id);
      if (!account || account.status !== 'converted') return NextResponse.json({ error: 'Subscribe to a plan first.' }, { status: 409 });
      const found = await findBrokerageSubscription(user.id);
      if (!found) return NextResponse.json({ error: 'Extra agents are billed through your Stripe subscription, and this account does not have one. Ask Relay to add them.' }, { status: 409 });
      const { data: links } = await supabaseServer.from('brokerage_links').select('status').eq('owner_user_id', user.id).in('status', ['active', 'pending']);
      const active = (links ?? []).filter((l) => l.status === 'active').length;
      const problem = validateExtraSeats(account.tier, requested, { active, pending: (links ?? []).length - active });
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      // Stripe first: if it refuses, nothing is recorded as bought.
      await setExtraAgentsOnSubscription(user.id, requested as number);
      await recordExtraSeats(user.id, requested as number, user.id);
      return NextResponse.json({ success: true, extraSeats: requested });
    }
    if (body.action !== 'request_upgrade') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    const label = (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) || user.email || 'A brokerage';
    await requestUpgrade(user.id, label);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PilotError) return NextResponse.json({ error: error.message }, { status: error.status });
    return oversightError(error, 'request the upgrade');
  }
}
