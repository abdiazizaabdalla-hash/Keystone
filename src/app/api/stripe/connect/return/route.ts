import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getConnectedAccountStatus, statusFromConnectedAccount } from '@/lib/stripeConnect';

// Where Stripe's hosted onboarding sends the TC back to. This is a plain
// browser redirect (no Authorization header, no Relay session), so the
// TC is identified by looking up OUR OWN payment_accounts row for the
// `account` id in the query string -- that id isn't secret, and we only
// ever use it to find a row we created ourselves in /start, then
// independently re-verify the account's real status with Stripe (the
// source of truth) rather than trusting anything from the query string.
//
// Fetching the live status here (rather than only relying on the
// account.updated webhook) means the TC sees the right state immediately
// even if a webhook listener isn't running yet in this environment.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const accountId = searchParams.get('account');
  const from = searchParams.get('from') === 'onboarding' ? 'onboarding' : 'settings';
  const finalPage = from === 'onboarding' ? '/onboarding' : '/dashboard/settings';

  if (!accountId) {
    return NextResponse.redirect(`${origin}${finalPage}?stripe=error`);
  }

  try {
    const { data: account } = await supabaseServer
      .from('payment_accounts')
      .select('id')
      .eq('connected_account_id', accountId)
      .eq('provider', 'stripe_connect')
      .maybeSingle();

    if (!account) {
      return NextResponse.redirect(`${origin}${finalPage}?stripe=error`);
    }

    const liveStatus = await getConnectedAccountStatus(accountId);
    await supabaseServer
      .from('payment_accounts')
      .update({ status: statusFromConnectedAccount(liveStatus), updated_at: new Date().toISOString() })
      .eq('connected_account_id', accountId)
      .eq('provider', 'stripe_connect');

    return NextResponse.redirect(`${origin}${finalPage}?stripe=connected`);
  } catch (error) {
    console.error('Error handling Stripe Connect return:', error);
    return NextResponse.redirect(`${origin}${finalPage}?stripe=error`);
  }
}
