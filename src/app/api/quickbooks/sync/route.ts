import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getQbConnection, syncInvoiceToQuickBooks, syncPendingForUser } from '@/lib/quickbooksSync';
import { supabaseServer } from '@/lib/supabase';

export const maxDuration = 60;

// "Send my invoices to QuickBooks" from Settings: a small batch per request, repeated by the page until none are left.
//   {}                       send the next batch of waiting invoices
//   { retryFailed: true }    include invoices that failed before
//   { invoiceId }            retry one invoice
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const conn = await getQbConnection(user.id);
    if (!conn) return NextResponse.json({ error: 'QuickBooks is not connected' }, { status: 400 });
    if (conn.status === 'needs_reconnect') return NextResponse.json({ error: 'QuickBooks needs to be reconnected first' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    if (typeof body.invoiceId === 'string') {
      // Only this TC's own invoices.
      const { data: inv } = await supabaseServer.from('invoices').select('agent_id').eq('id', body.invoiceId).maybeSingle();
      const { data: agent } = inv ? await supabaseServer.from('agents').select('tc_user_id').eq('id', inv.agent_id).maybeSingle() : { data: null };
      if (!agent || agent.tc_user_id !== user.id) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      const r = await syncInvoiceToQuickBooks(body.invoiceId);
      return NextResponse.json({ processed: 1, ok: r.ok ? 1 : 0, failed: r.ok ? 0 : 1, remaining: 0, message: r.message || null });
    }
    return NextResponse.json(await syncPendingForUser(user.id, 12, body.retryFailed === true));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error syncing to QuickBooks:', error);
    return NextResponse.json({ error: 'Could not send invoices to QuickBooks' }, { status: 500 });
  }
}
