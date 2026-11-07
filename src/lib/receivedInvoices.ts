import { supabaseServer } from '@/lib/supabase';
import { isInvoiceRecipient, invoiceTotals } from '@/lib/workspaceInvoices';
import { isStripePayAvailable } from '@/lib/stripeConnect';

export interface ReceivedInvoice {
  id: string;
  invoice_number: string;
  title: string;
  status: 'sent' | 'paid';
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  refundedAmount: number;
  transaction_id: string | null;
  propertyAddress: string | null;
  fromName: string;
  fromEmail: string;
  ownerUserId: string;
  total: number;
  taxPercent: number;
  lines: Array<{ description: string; quantity: number; unitPrice: number }>;
  payOnline: boolean;
}

type Viewer = Parameters<typeof isInvoiceRecipient>[1];

/** Invoices that agents sent to this person: billed to their email, or sent on a deal they coordinate. Newest first. */
export async function loadReceivedInvoices(user: Viewer, options: { withPayAvailability?: boolean } = {}): Promise<ReceivedInvoice[]> {
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
  if (list.length === 0) return [];

  const ids = list.map((i) => i.id as string);
  const { data: lines } = await supabaseServer.from('workspace_invoice_lines').select('invoice_id, position, description, quantity, unit_price').in('invoice_id', ids).order('position', { ascending: true });
  const byInvoice = new Map<string, Array<{ description: string; quantity: number; unitPrice: number }>>();
  for (const l of lines || []) {
    const arr = byInvoice.get(l.invoice_id as string) || [];
    arr.push({ description: String(l.description || ''), quantity: Number(l.quantity), unitPrice: Number(l.unit_price) });
    byInvoice.set(l.invoice_id as string, arr);
  }

  const ownerIds = [...new Set(list.map((i) => i.owner_user_id as string))];
  const names = new Map<string, { name: string; email: string }>();
  const pay = new Map<string, boolean>();
  await Promise.all(
    ownerIds.map(async (id) => {
      const { data } = await supabaseServer.auth.admin.getUserById(id);
      names.set(id, { name: (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Agent', email: data.user?.email || '' });
      if (options.withPayAvailability !== false) pay.set(id, await isStripePayAvailable(id));
    })
  );
  const txIds = [...new Set(list.map((i) => i.transaction_id as string | null).filter(Boolean))] as string[];
  const { data: txs } = txIds.length ? await supabaseServer.from('transactions').select('id, property_address').in('id', txIds) : { data: [] as { id: string; property_address: string }[] };
  const address = new Map((txs || []).map((t) => [t.id as string, t.property_address as string]));

  return list
    .map((inv): ReceivedInvoice => {
      const invLines = byInvoice.get(inv.id as string) || [];
      return {
        id: inv.id as string,
        invoice_number: inv.invoice_number as string,
        title: (inv.title as string) || '',
        status: inv.status as 'sent' | 'paid',
        issue_date: inv.issue_date as string,
        due_date: (inv.due_date as string | null) ?? null,
        paid_at: (inv.paid_at as string | null) ?? null,
        refundedAmount: Number(inv.refunded_amount || 0),
        transaction_id: (inv.transaction_id as string | null) ?? null,
        propertyAddress: inv.transaction_id ? address.get(inv.transaction_id as string) ?? null : null,
        fromName: names.get(inv.owner_user_id as string)?.name ?? 'Agent',
        fromEmail: names.get(inv.owner_user_id as string)?.email ?? '',
        ownerUserId: inv.owner_user_id as string,
        total: invoiceTotals(invLines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })), Number(inv.tax_percent)).total,
        taxPercent: Number(inv.tax_percent || 0),
        lines: invLines,
        payOnline: pay.get(inv.owner_user_id as string) ?? false,
      };
    })
    .sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
}
