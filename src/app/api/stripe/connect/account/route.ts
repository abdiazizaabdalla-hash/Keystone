import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

// Lets a TC check their own Stripe Connect status, reading from the
// generic payment_accounts table (provider = 'stripe_connect').
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const { data } = await supabaseServer
      .from('payment_accounts')
      .select('status, connected_account_id')
      .eq('tc_user_id', user.id)
      .eq('provider', 'stripe_connect')
      .maybeSingle();

    return NextResponse.json({
      connected: !!data,
      status: data?.status || null,
      paymentPreference: (user.user_metadata?.payment_preference as string | undefined) || null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to load Stripe Connect status' }, { status: 500 });
  }
}
