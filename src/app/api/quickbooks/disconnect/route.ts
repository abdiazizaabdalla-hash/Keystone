import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { decryptSecret } from '@/lib/encryption';
import { revokeQbToken } from '@/lib/quickbooksApi';
import { clearQuickBooksLinks, getQbConnection } from '@/lib/quickbooksSync';
import { logAudit } from '@/lib/audit';

// Disconnect: tells Intuit to drop the grant, deletes the stored tokens, and forgets what was linked.
// Nothing already in QuickBooks is touched.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const conn = await getQbConnection(user.id);
    if (conn) {
      try {
        await revokeQbToken(decryptSecret(conn.refresh_token));
      } catch {
        /* the grant can also be removed from Intuit's side */
      }
      await supabaseServer.from('quickbooks_connections').delete().eq('tc_user_id', user.id);
      await clearQuickBooksLinks(user.id);
      await logAudit(request, user, 'quickbooks.disconnect', { entityType: 'integration', entityId: 'quickbooks' });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error disconnecting QuickBooks:', error);
    return NextResponse.json({ error: 'Could not disconnect' }, { status: 500 });
  }
}
