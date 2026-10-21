import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { toCsv } from '@/lib/contactsCrm';
import { logAudit } from '@/lib/audit';
import {
  DEFAULT_ITEM_NAME,
  QB_CUSTOMER_HEADERS,
  QB_INVOICE_HEADERS,
  QB_MAX_INVOICES_PER_FILE,
  QB_PAYMENT_HEADERS,
  money,
  usDate,
} from '@/lib/quickbooks';

// CSV files for QuickBooks Online, built from THIS TC's own invoices and agents. Nothing is sent to QuickBooks:
// the TC downloads a file and uses QuickBooks' own Import data screen.
//   ?type=invoices   open invoices in QuickBooks' invoice-import layout  (&status=open|all, &from=, &to=, &item=, &part=1,2…)
//   ?type=payments   payments received (a report: QuickBooks' invoice import can't record payments)
//   ?type=customers  agents, for QuickBooks' customer import
//   ?type=count      how many invoices match, so the screen can offer one download per 100

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface InvoiceRow {
  id: string;
  agent_id: string;
  transaction_id: string;
  amount_owed: number;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_amount: number | null;
  refunded_amount: number | null;
}

function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

    const p = new URL(request.url).searchParams;
    const type = p.get('type') || 'invoices';
    const from = p.get('from') || '';
    const to = p.get('to') || '';
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
      return NextResponse.json({ error: 'Dates must look like 2026-10-21' }, { status: 400 });
    }

    const { data: agents, error: agentError } = await supabaseServer
      .from('agents')
      .select('id, name, brokerage, email, phone')
      .eq('tc_user_id', user.id)
      .limit(5000);
    if (agentError) throw agentError;
    const agentList = agents || [];

    if (type === 'customers') {
      const csv = toCsv(
        QB_CUSTOMER_HEADERS,
        agentList.map((a) => [a.name, a.brokerage, a.email, a.phone])
      );
      await logAudit(request, user, 'quickbooks.export', { entityType: 'export', entityId: 'customers' });
      return csvResponse(csv, 'relay-customers-for-quickbooks.csv');
    }

    if (type !== 'invoices' && type !== 'payments' && type !== 'count') {
      return NextResponse.json({ error: 'Unknown export' }, { status: 400 });
    }

    const agentById = new Map(agentList.map((a) => [a.id as string, a]));
    if (agentById.size === 0) {
      return type === 'count' ? NextResponse.json({ count: 0, parts: 0 }) : csvResponse(toCsv(type === 'payments' ? QB_PAYMENT_HEADERS : QB_INVOICE_HEADERS, []), `relay-${type}.csv`);
    }

    const statusAll = p.get('status') === 'all';
    let query = supabaseServer
      .from('invoices')
      .select('id, agent_id, transaction_id, amount_owed, invoice_number, invoice_date, due_date, paid, paid_at, paid_amount, refunded_amount')
      .in('agent_id', [...agentById.keys()])
      .order('invoice_date', { ascending: true })
      .order('invoice_number', { ascending: true })
      .limit(5000);

    if (type === 'payments') {
      query = query.eq('paid', true);
      if (from) query = query.gte('paid_at', `${from}T00:00:00`);
      if (to) query = query.lte('paid_at', `${to}T23:59:59`);
    } else {
      if (!statusAll) query = query.eq('paid', false);
      if (from) query = query.gte('invoice_date', `${from}T00:00:00`);
      if (to) query = query.lte('invoice_date', `${to}T23:59:59`);
    }

    const { data: invoiceRows, error } = await query;
    if (error) throw error;
    const invoices = (invoiceRows || []) as InvoiceRow[];

    if (type === 'count') {
      return NextResponse.json({ count: invoices.length, parts: Math.ceil(invoices.length / QB_MAX_INVOICES_PER_FILE) });
    }

    const txIds = [...new Set(invoices.map((i) => i.transaction_id).filter(Boolean))];
    const { data: txRows } = txIds.length
      ? await supabaseServer.from('transactions').select('id, file_number, property_address').in('id', txIds)
      : { data: [] as { id: string; file_number: string; property_address: string }[] };
    const txById = new Map((txRows || []).map((t) => [t.id as string, t]));

    if (type === 'payments') {
      const csv = toCsv(
        QB_PAYMENT_HEADERS,
        invoices.map((inv) => {
          const gross = inv.paid_amount ?? inv.amount_owed;
          const refunded = inv.refunded_amount || 0;
          const tx = txById.get(inv.transaction_id);
          return [
            inv.invoice_number,
            agentById.get(inv.agent_id)?.name || '',
            usDate(inv.paid_at),
            money(gross),
            money(refunded),
            money(gross - refunded),
            money(inv.amount_owed),
            tx?.property_address || '',
            tx?.file_number || '',
            'Relay (marked paid)',
          ];
        })
      );
      await logAudit(request, user, 'quickbooks.export', { entityType: 'export', entityId: 'payments' });
      return csvResponse(csv, 'relay-payments-for-quickbooks.csv');
    }

    // Invoices: one file holds at most 100 (QuickBooks' limit); ?part= picks which 100.
    const part = Math.max(1, Math.floor(Number(p.get('part')) || 1));
    const slice = invoices.slice((part - 1) * QB_MAX_INVOICES_PER_FILE, part * QB_MAX_INVOICES_PER_FILE);
    const item = (p.get('item') || DEFAULT_ITEM_NAME).trim().slice(0, 100) || DEFAULT_ITEM_NAME;

    const csv = toCsv(
      QB_INVOICE_HEADERS,
      slice.map((inv) => {
        const tx = txById.get(inv.transaction_id);
        const desc = tx ? `${item} - ${tx.property_address} (${tx.file_number})` : item;
        return [
          inv.invoice_number,
          agentById.get(inv.agent_id)?.name || '',
          usDate(inv.invoice_date),
          usDate(inv.due_date),
          tx ? `${tx.property_address} · File ${tx.file_number}` : '',
          item,
          desc,
          1,
          money(inv.amount_owed),
          money(inv.amount_owed),
        ];
      })
    );
    await logAudit(request, user, 'quickbooks.export', { entityType: 'export', entityId: 'invoices' });
    return csvResponse(csv, `relay-invoices-for-quickbooks${part > 1 || invoices.length > QB_MAX_INVOICES_PER_FILE ? `-part-${part}` : ''}.csv`);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error exporting for QuickBooks:', error);
    return NextResponse.json({ error: 'Failed to build the export' }, { status: 500 });
  }
}
