import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { mergeUserMetadata } from '@/lib/userMetadata';
import { createStandardConnectedAccount, createOnboardingLink } from '@/lib/stripeConnect';

// Starts (or resumes) Stripe Connect onboarding for the signed-in TC.
// Reuses an existing connected account if one was already created (Account
// Links are single-use/short-lived, but the underlying Account persists
// across as many onboarding attempts as it takes), otherwise creates a
// fresh Standard account first.
//
// `from` controls where Stripe sends the TC back to once onboarding is
// done -- either the onboarding flow's payment step, or Settings, so
// "Connect Stripe" reads naturally from either entry point instead of
// always dropping them in Settings.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const from = body?.from === 'onboarding' ? 'onboarding' : 'settings';

    const { data: existing, error: fetchError } = await supabaseServer
      .from('payment_accounts')
      .select('connected_account_id')
      .eq('tc_user_id', user.id)
      .eq('provider', 'stripe_connect')
      .maybeSingle();

    if (fetchError) throw fetchError;

    let accountId = existing?.connected_account_id;

    if (!accountId) {
      accountId = await createStandardConnectedAccount({ email: user.email });

      const { error: insertError } = await supabaseServer.from('payment_accounts').insert({
        tc_user_id: user.id,
        provider: 'stripe_connect',
        connected_account_id: accountId,
        status: 'pending',
      });
      if (insertError) throw insertError;
    }

    // Recording the TC's choice as soon as they start connecting, not only
    // once it's fully approved -- Settings/onboarding show a "pending"
    // state in between rather than looking like nothing happened. Goes
    // through mergeUserMetadata (a fresh read right before the write)
    // rather than spreading `user.user_metadata` from earlier in this
    // request -- see lib/userMetadata.ts for why that distinction matters.
    await mergeUserMetadata(user.id, { payment_preference: 'stripe' });

    const origin = new URL(request.url).origin;
    const finalPage = from === 'onboarding' ? `${origin}/onboarding` : `${origin}/dashboard/settings`;

    const url = await createOnboardingLink(accountId, {
      returnUrl: `${origin}/api/stripe/connect/return?account=${accountId}&from=${from}`,
      refreshUrl: `${finalPage}?stripe=refresh`,
    });

    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error starting Stripe Connect onboarding:', error);
    return NextResponse.json({ error: 'Failed to start Stripe Connect onboarding' }, { status: 500 });
  }
}
