import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getQbAuthUrl, quickbooksAvailableFor } from '@/lib/quickbooksApi';
import { signOAuthState } from '@/lib/oauthState';

// Starts "Connect QuickBooks" for a signed-in coordinator. Returns the Intuit URL for the page to open.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    if (!quickbooksAvailableFor(user.email)) {
      return NextResponse.json({ error: 'The QuickBooks connection is not open yet. You can still move invoices with the import and export files.' }, { status: 403 });
    }
    const origin = new URL(request.url).origin;
    const url = getQbAuthUrl(`${origin}/api/quickbooks/callback`, signOAuthState(user.id, 'quickbooks'));
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error starting QuickBooks connection:', error);
    return NextResponse.json({ error: 'Could not start the QuickBooks connection' }, { status: 500 });
  }
}
