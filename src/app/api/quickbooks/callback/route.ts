import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { verifyOAuthState } from '@/lib/oauthState';
import { encryptSecret } from '@/lib/encryption';
import { exchangeQbCode, getCompanyName, qbEnvironment } from '@/lib/quickbooksApi';

// Where Intuit sends the user back after they approve. A plain browser redirect with no session, so the user is
// identified by the signed `state` (same approach as the Google Calendar connection).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const page = `${origin}/dashboard/settings`;
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const stateToken = searchParams.get('state');
  const state = stateToken ? verifyOAuthState(stateToken) : null;

  if (searchParams.get('error') || !code || !realmId || !state || state.from !== 'quickbooks') {
    return NextResponse.redirect(`${page}?quickbooks=error#quickbooks`);
  }

  try {
    const tokens = await exchangeQbCode(code, `${origin}/api/quickbooks/callback`);
    const environment = qbEnvironment();
    const companyName = await getCompanyName({ realmId, environment, accessToken: tokens.access_token });

    const { error } = await supabaseServer.from('quickbooks_connections').upsert(
      {
        tc_user_id: state.userId,
        realm_id: realmId,
        company_name: companyName,
        environment,
        refresh_token: encryptSecret(tokens.refresh_token),
        access_token: encryptSecret(tokens.access_token),
        access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        status: 'connected',
        item_id: null, // looked up again for the new company
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tc_user_id' }
    );
    if (error) throw error;
    return NextResponse.redirect(`${page}?quickbooks=connected#quickbooks`);
  } catch (error) {
    console.error('Error completing QuickBooks connection:', error instanceof Error ? error.message : error);
    return NextResponse.redirect(`${page}?quickbooks=error#quickbooks`);
  }
}
