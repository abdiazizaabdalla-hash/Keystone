import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { quickbooksAvailableFor } from '@/lib/quickbooksApi';
import { countQuickBooksWork, getQbConnection } from '@/lib/quickbooksSync';

// What the Settings card shows. Never returns a token.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const conn = await getQbConnection(user.id);
    const work = conn ? await countQuickBooksWork(user.id) : { pending: 0, needsAttention: 0 };
    return NextResponse.json({
      available: Boolean(conn) || quickbooksAvailableFor(user.email),
      connected: Boolean(conn),
      needsReconnect: conn?.status === 'needs_reconnect',
      companyName: conn?.company_name || null,
      environment: conn?.environment || null,
      syncInvoices: conn?.sync_invoices ?? true,
      syncPayments: conn?.sync_payments ?? true,
      lastSyncedAt: (conn as { last_synced_at?: string | null } | null)?.last_synced_at || null,
      pending: work.pending,
      needsAttention: work.needsAttention,
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading QuickBooks status:', error);
    return NextResponse.json({ error: 'Failed to load QuickBooks status' }, { status: 500 });
  }
}

// Turn "create invoices" and "record payments" on or off.
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, boolean | string> = {};
    if (typeof body.syncInvoices === 'boolean') patch.sync_invoices = body.syncInvoices;
    if (typeof body.syncPayments === 'boolean') patch.sync_payments = body.syncPayments;
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    patch.updated_at = new Date().toISOString();
    const { error } = await supabaseServer.from('quickbooks_connections').update(patch).eq('tc_user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error saving QuickBooks settings:', error);
    return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  }
}
