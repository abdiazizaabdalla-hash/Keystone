import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { toCsv } from '@/lib/contactsCrm';
import { logAudit } from '@/lib/audit';
import { assertInvoiceSender, invoiceTotals } from '@/lib/workspaceInvoices';
import { DEFAULT_ITEM_NAME, QB_CUSTOMER_HEADERS, QB_INVOICE_HEADERS, QB_MAX_INVOICES_PER_FILE, QB_PAYMENT_HEADERS, money, usDate } from '@/lib/quickbooks';

// CSV files for QuickBooks Online, built from THIS agent's own invoices (the ones sent from their workspace). Nothing is sent to
// QuickBooks: they download a file and use QuickBooks' own Import data screen. Same files as a coordinator gets.
//   ?type=invoices   invoices in QuickBooks' invoice-import layout, one row per line  (&status=open|all, &from=, &to=, &item=, &part=)
//   ?type=payments   payments received (a report: QuickBooks' invoice import can't record payments)
//   ?type=customers  the people invoices were billed to, for QuickBooks' customer import
//   ?type=count      how many invoices match, so the screen can offer one download per 100

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  });
}

interface Inv {
  id: string;
  invoice_number: string;
  title: string;
  bill_to_name: string;
  bill_to_email: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string;
  memo: string | null;
  tax_percent: number;
  paid_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertInvoiceSender(user);
    const p = request.nextUrl.searchParams;
    const type = p.get('type') || 'invoices';
    const from = p.get('from') || '';
    const to = p.get('to') || '';
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return NextResponse.json({ error: 'Dates must look like 2026-10-21' }, { status: 400 });
    if (!['invoices', 'payments', 'customers', 'count'].includes(type)) return NextResponse.json({ error: 'Unknown export' }, { status: 400 });

    let query = supabaseServer
      .from('workspace_invoices')
      .select('id, invoice_number, title, bill_to_name, bill_to_email, issue_date, due_date, status, memo, tax_percent, paid_at')
      .eq('owner_user_id', user.id)
      .neq('status', 'void')
      .order('issue_date', { ascending: true })
      .order('invoice_number', { ascending: true })
      .limit(5000);
    if (type === 'payments') {
      query = query.eq('status', 'paid');
      if (from) query = query.gte('paid_at', `${from}T00:00:00`);
      if (to) query = query.lte('paid_at', `${to}T23:59:59`);
    } else {
      if (from) query = query.gte('issue_date', from);
      if (to) query = query.lte('issue_date', to);
    }
    const { data, error } = await query;
    if (error) throw error;
    const all = (data || []) as Inv[];

    if (type === 'customers') {
      const seen = new Map<string, Inv>();
      for (const i of all) if (i.bill_to_name && !seen.has(i.bill_to_name.toLowerCase())) seen.set(i.bill_to_name.toLowerCase(), i);
      await logAudit(request, user, 'quickbooks.export', { entityType: 'export', entityId: 'customers' });
      return csvResponse(toCsv(QB_CUSTOMER_HEADERS, [...seen.values()].map((i) => [i.bill_to_name, '', i.bill_to_email ?? '', ''])), 'relay-customers-for-quickbooks.csv');
    }

    const ids = all.map((i) => i.id);
    const { data: lineRows } = ids.length
      ? await supabaseServer.from('workspace_invoice_lines').select('invoice_id, position, description, quantity, unit_price').in('invoice_id', ids).order('position')
      : { data: [] as Array<{ invoice_id: string; position: number; description: string; quantity: number; unit_price: number }> };
    const linesBy = new Map<string, Array<{ description: string; quantity: number; unitPrice: number }>>();
    for (const l of lineRows || []) {
      const arr = linesBy.get(l.invoice_id as string) || [];
      arr.push({ description: l.description as string, quantity: Number(l.quantity), unitPrice: Number(l.unit_price) });
      linesBy.set(l.invoice_id as string, arr);
    }
    const totalOf = (i: Inv) => invoiceTotals(linesBy.get(i.id) || [], Number(i.tax_percent)).total;
    // Drafts are not real yet, and $0 invoices give QuickBooks nothing to record.
    const statusAll = p.get('status') === 'all';
    const real = all.filter((i) => i.status !== 'draft' && totalOf(i) > 0);

    if (type === 'count') {
      const unpaid = real.filter((i) => i.status !== 'paid').length;
      const count = statusAll ? real.length : unpaid;
      return NextResponse.json({ count, unpaid, paid: real.length - unpaid, parts: Math.ceil(count / QB_MAX_INVOICES_PER_FILE) });
    }

    if (type === 'payments') {
      const csv = toCsv(
        QB_PAYMENT_HEADERS,
        real.map((i) => [i.invoice_number, i.bill_to_name || 'Unknown customer', usDate(i.paid_at), money(totalOf(i)), money(0), money(totalOf(i)), money(totalOf(i)), i.title, '', 'Relay (marked paid)'])
      );
      await logAudit(request, user, 'quickbooks.export', { entityType: 'export', entityId: 'payments' });
      return csvResponse(csv, 'relay-payments-for-quickbooks.csv');
    }

    const wanted = statusAll ? real : real.filter((i) => i.status !== 'paid');
    const part = Math.max(1, Math.floor(Number(p.get('part')) || 1));
    const slice = wanted.slice((part - 1) * QB_MAX_INVOICES_PER_FILE, part * QB_MAX_INVOICES_PER_FILE);
    const item = p.has('item') ? (p.get('item') || '').trim().slice(0, 100) : DEFAULT_ITEM_NAME;
    const rows: Array<Array<string | number>> = [];
    for (const i of slice) {
      const lines = linesBy.get(i.id) || [];
      for (const l of lines) {
        rows.push([i.invoice_number, i.bill_to_name || 'Unknown customer', usDate(i.issue_date), usDate(i.due_date), i.title || i.memo || '', item, l.description, l.quantity, money(l.unitPrice), money(l.quantity * l.unitPrice)]);
      }
    }
    await logAudit(request, user, 'quickbooks.export', { entityType: 'export', entityId: 'invoices' });
    return csvResponse(toCsv(QB_INVOICE_HEADERS, rows), `relay-invoices-for-quickbooks${part > 1 || wanted.length > QB_MAX_INVOICES_PER_FILE ? `-part-${part}` : ''}.csv`);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error exporting an agent’s invoices for QuickBooks:', error);
    return NextResponse.json({ error: 'Failed to build the export' }, { status: 500 });
  }
}
