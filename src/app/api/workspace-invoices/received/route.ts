import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isCollaboratorOnly } from '@/lib/agentPortal';
import { isInvoiceRecipient, invoiceTotals } from '@/lib/workspaceInvoices';
import { isStripePayAvailable } from '@/lib/stripeConnect';
import { isFeatureOn } from '@/lib/features';

// GET: invoices that agents sent to this coordinator (billed to their email, or sent on a deal they are the coordinator on).
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    // Agent-sent invoices only exist where the agent workspace is on; skip the lookups (and the tables) everywhere else.
    if (!isFeatureOn('agent_workspace')) return NextResponse.json([]);
    if (isCollaboratorOnly(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const email = (user.email || '').trim().toLowerCase();

    const [{ data: byEmail }, { data: links }, { data: owned }] = await Promise.all([
      email ? supabaseServer.from('workspace_invoices').select('*').ilike('bill_to_email', email.replace(/[%_]/g, '\\$&')).in('status', ['sent', 'paid']).limit(200) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      supabaseServer.from('transaction_agents').select('transaction_id').eq('agent_user_id', user.id),
      supabaseServer.from('transactions').select('id').eq('tc_user_id', user.id).limit(2000),
    ]);
    const dealIds = [...new Set([...(links || []).map((l) => l.transaction_id as string), ...(owned || []).map((t) => t.id as string)])];
    const { data: byDeal } = dealIds.length
      ? await supabaseServer.from('workspace_invoices').select('*').in('transaction_id', dealIds).in('status', ['sent', 'paid']).limit(500)
      : { data: [] as Record<string, unknown>[] };

    const candidates = new Map<string, Record<string, unknown>>();
    for (const inv of [...(byEmail || []), ...(byDeal || [])]) candidates.set(inv.id as string, inv);
    const list: Record<string, unknown>[] = [];
    for (const inv of candidates.values()) {
      if (inv.owner_user_id === user.id) continue;
      if (await isInvoiceRecipient(inv as never, user)) list.push(inv);
    }
    if (list.length === 0) return NextResponse.json([]);

    const ids = list.map((i) => i.id as string);
    const { data: lines } = await supabaseServer.from('workspace_invoice_lines').select('invoice_id, quantity, unit_price').in('invoice_id', ids);
    const byInvoice = new Map<string, Array<{ quantity: number; unitPrice: number }>>();
    for (const l of lines || []) {
      const arr = byInvoice.get(l.invoice_id as string) || [];
      arr.push({ quantity: Number(l.quantity), unitPrice: Number(l.unit_price) });
      byInvoice.set(l.invoice_id as string, arr);
    }

    const ownerIds = [...new Set(list.map((i) => i.owner_user_id as string))];
    const names = new Map<string, string>();
    const pay = new Map<string, boolean>();
    await Promise.all(
      ownerIds.map(async (id) => {
        const { data } = await supabaseServer.auth.admin.getUserById(id);
        names.set(id, (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Agent');
        pay.set(id, await isStripePayAvailable(id));
      })
    );
    const txIds = [...new Set(list.map((i) => i.transaction_id as string | null).filter(Boolean))] as string[];
    const { data: txs } = txIds.length ? await supabaseServer.from('transactions').select('id, property_address').in('id', txIds) : { data: [] as { id: string; property_address: string }[] };
    const address = new Map((txs || []).map((t) => [t.id as string, t.property_address as string]));

    return NextResponse.json(
      list
        .map((inv) => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          title: inv.title,
          status: inv.status,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          paid_at: inv.paid_at ?? null,
          transaction_id: inv.transaction_id ?? null,
          propertyAddress: inv.transaction_id ? address.get(inv.transaction_id as string) ?? null : null,
          fromName: names.get(inv.owner_user_id as string) ?? 'Agent',
          total: invoiceTotals(byInvoice.get(inv.id as string) || [], Number(inv.tax_percent)).total,
          payOnline: pay.get(inv.owner_user_id as string) ?? false,
        }))
        .sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)))
    );
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading invoices from agents:', error);
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 });
  }
}
