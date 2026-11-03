import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { authorizeDeal } from '@/lib/authorize';
import { logAudit } from '@/lib/audit';
import { getInvoiceTemplate } from '@/lib/workspaceInvoiceTemplates';
import {
  assertWorkspaceAgent,
  cleanDate,
  cleanHeader,
  cleanLines,
  findDealCoordinator,
  invoiceTotals,
  nextInvoiceNumber,
  replaceLines,
} from '@/lib/workspaceInvoices';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} workspace invoices:`, error);
  return NextResponse.json({ error: `Failed to ${what} invoices` }, { status: 500 });
}

// GET: this agent's own invoices with totals; ?transactionId= narrows to one deal.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    let query = supabaseServer.from('workspace_invoices').select('*').eq('owner_user_id', user.id).order('created_at', { ascending: false }).limit(500);
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    if (transactionId) query = query.eq('transaction_id', transactionId);
    const { data: invoices, error } = await query;
    if (error) throw error;
    const ids = (invoices || []).map((i) => i.id as string);
    const { data: lines } = ids.length
      ? await supabaseServer.from('workspace_invoice_lines').select('invoice_id, quantity, unit_price').in('invoice_id', ids)
      : { data: [] as Array<{ invoice_id: string; quantity: number; unit_price: number }> };
    const byInvoice = new Map<string, Array<{ quantity: number; unitPrice: number }>>();
    for (const l of lines || []) {
      const arr = byInvoice.get(l.invoice_id as string) || [];
      arr.push({ quantity: Number(l.quantity), unitPrice: Number(l.unit_price) });
      byInvoice.set(l.invoice_id as string, arr);
    }
    return NextResponse.json((invoices || []).map((inv) => ({ ...inv, ...invoiceTotals(byInvoice.get(inv.id as string) || [], inv.tax_percent) })));
  } catch (error) {
    return fail(error, 'load');
  }
}

// POST: create an invoice, optionally from a template, a contact and a deal.
// A deal can only be attached when a coordinator is on it; the bill-to then defaults to that coordinator.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    await assertTrialActive(user);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const template = getInvoiceTemplate(typeof body.templateKey === 'string' ? body.templateKey : null);
    const header = cleanHeader(body);
    const issueDate = (header.issue_date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const dueDate =
      'due_date' in header
        ? (header.due_date as string | null)
        : new Date(Date.parse(issueDate) + template.dueInDays * 86_400_000).toISOString().slice(0, 10);

    let billToName = (header.bill_to_name as string | undefined) ?? '';
    let billToEmail = (header.bill_to_email as string | null | undefined) ?? null;
    let billToAddress = (header.bill_to_address as string | null | undefined) ?? null;
    let contactId: string | null = null;

    if (typeof body.contactId === 'string' && body.contactId) {
      const { data: contact } = await supabaseServer.from('contacts').select('id, name, email, company, tc_user_id').eq('id', body.contactId).maybeSingle();
      if (!contact || contact.tc_user_id !== user.id) throw new AuthError('Contact not found', 404);
      contactId = contact.id as string;
      if (!billToName) billToName = (contact.company as string | null) ? `${contact.name ? contact.name + ', ' : ''}${contact.company}` : ((contact.name as string) || '');
      if (!billToEmail) billToEmail = (contact.email as string | null) ?? null;
    }

    let transactionId: string | null = null;
    let dealNote = '';
    if (typeof body.transactionId === 'string' && body.transactionId) {
      await authorizeDeal(user, false, body.transactionId, {
        scope: 'team',
        participants: 'full',
        collaborators: false,
        deniedMessage: 'You do not have permission to invoice this transaction',
      });
      const coordinator = await findDealCoordinator(body.transactionId, user.id);
      if (!coordinator) {
        return NextResponse.json({ error: 'An invoice can be attached to a deal only when a coordinator is on it.' }, { status: 400 });
      }
      transactionId = body.transactionId;
      if (!billToName) billToName = coordinator.name;
      if (!billToEmail) billToEmail = coordinator.email;
      const { data: tx } = await supabaseServer.from('transactions').select('property_address').eq('id', transactionId).maybeSingle();
      if (tx?.property_address) dealNote = `Re: ${tx.property_address}`;
    }

    const lines = Array.isArray(body.lines) ? cleanLines(body.lines) : template.lines.map((l) => ({ ...l }));
    const memo = (header.memo as string | null | undefined) ?? ([dealNote, template.memo].filter(Boolean).join('\n\n') || null);
    const title = (header.title as string | undefined) ?? template.title;
    const invoiceNumber = await nextInvoiceNumber(user.id);

    const { data: created, error } = await supabaseServer
      .from('workspace_invoices')
      .insert({
        owner_user_id: user.id,
        invoice_number: invoiceNumber,
        template_key: template.key,
        title,
        contact_id: contactId,
        bill_to_name: billToName,
        bill_to_email: billToEmail,
        bill_to_address: billToAddress,
        transaction_id: transactionId,
        issue_date: issueDate,
        due_date: dueDate ?? cleanDate(body.dueDate),
        memo,
        tax_percent: (header.tax_percent as number | undefined) ?? 0,
      })
      .select('*')
      .single();
    if (error) throw error;
    await replaceLines(created.id as string, lines);
    await logAudit(request, user, 'workspace_invoice.create', { entityType: 'workspace_invoice', entityId: created.id as string });
    return NextResponse.json({ ...created, lines, ...invoiceTotals(lines, created.tax_percent) }, { status: 201 });
  } catch (error) {
    return fail(error, 'create');
  }
}
