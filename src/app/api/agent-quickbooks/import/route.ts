import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logAudit } from '@/lib/audit';
import { assertInvoiceSender } from '@/lib/workspaceInvoices';
import { relayInvoiceNumber, type QbRowInput } from '@/lib/quickbooks';

// Bring invoices from a QuickBooks export (read in the browser) into this agent's own Invoices. Nothing is sent to QuickBooks.
//   POST { mode: 'preview', rows }                 -> each row marked ready or duplicate (that number is already here)
//   POST { mode: 'commit', rows: [{...row, include, paid}] } -> creates them (sent, or paid)
//   DELETE { invoiceIds }                          -> undo: removes invoices this import made
const MAX_ROWS = 500;
const IMPORT_KEY = 'quickbooks_import';

function cleanRows(raw: unknown): Array<QbRowInput & { include?: boolean; paid?: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<QbRowInput & { include?: boolean; paid?: boolean }> = [];
  for (const r of raw.slice(0, MAX_ROWS)) {
    const x = r as Record<string, unknown>;
    const amount = Number(x.amount);
    const number = typeof x.number === 'string' ? x.number.trim() : '';
    const customer = typeof x.customer === 'string' ? x.customer.trim() : '';
    if (!number || !customer || !Number.isFinite(amount) || amount <= 0 || amount >= 100_000_000) continue;
    const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    out.push({
      row: Number(x.row) || 0,
      number: number.slice(0, 80),
      customer: customer.slice(0, 140),
      amount: Math.round(amount * 100) / 100,
      date: date(x.date),
      due: date(x.due),
      balance: typeof x.balance === 'number' ? x.balance : null,
      text: typeof x.text === 'string' ? x.text.slice(0, 300) : '',
      paid_date: date(x.paid_date),
      include: x.include !== false,
      paid: x.paid === true,
    });
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertInvoiceSender(user);
    await assertTrialActive(user);
    const body = (await request.json().catch(() => ({}))) as { mode?: string; rows?: unknown };
    const rows = cleanRows(body.rows);
    if (rows.length === 0) return NextResponse.json({ error: 'No invoices to import' }, { status: 400 });

    const { data: existing } = await supabaseServer.from('workspace_invoices').select('invoice_number').eq('owner_user_id', user.id);
    const taken = new Set((existing || []).map((e) => String(e.invoice_number).toLowerCase()));

    if (body.mode !== 'commit') {
      return NextResponse.json({ rows: rows.map((r) => ({ ...r, relayNumber: relayInvoiceNumber(r.number), status: taken.has(relayInvoiceNumber(r.number).toLowerCase()) ? 'duplicate' : 'ready' })) });
    }

    const created: string[] = [];
    const skipped: { number: string; reason: string }[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      if (r.include === false) continue;
      const number = relayInvoiceNumber(r.number);
      if (taken.has(number.toLowerCase())) {
        skipped.push({ number: r.number, reason: 'Already in your invoices' });
        continue;
      }
      const isPaid = r.paid === true || r.balance === 0;
      const issue = r.date || today;
      const { data: inv, error } = await supabaseServer
        .from('workspace_invoices')
        .insert({
          owner_user_id: user.id,
          invoice_number: number,
          template_key: IMPORT_KEY,
          title: 'Imported from QuickBooks',
          bill_to_name: r.customer,
          issue_date: issue,
          due_date: r.due || null,
          status: isPaid ? 'paid' : 'sent',
          memo: r.text || null,
          sent_at: new Date(`${issue}T12:00:00Z`).toISOString(),
          paid_at: isPaid ? new Date(`${r.paid_date || issue}T12:00:00Z`).toISOString() : null,
        })
        .select('id')
        .single();
      if (error || !inv) {
        skipped.push({ number: r.number, reason: 'Could not be saved' });
        continue;
      }
      const { error: lineError } = await supabaseServer
        .from('workspace_invoice_lines')
        .insert({ invoice_id: inv.id, position: 0, description: (r.text || 'Imported from QuickBooks').slice(0, 300), quantity: 1, unit_price: r.amount });
      if (lineError) {
        await supabaseServer.from('workspace_invoices').delete().eq('id', inv.id);
        skipped.push({ number: r.number, reason: 'Could not be saved' });
        continue;
      }
      taken.add(number.toLowerCase());
      created.push(inv.id as string);
    }
    await logAudit(request, user, 'quickbooks.import', { entityType: 'import', entityId: `${created.length}` });
    return NextResponse.json({ created: created.length, createdInvoiceIds: created, skipped });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error importing QuickBooks invoices for an agent:', error);
    return NextResponse.json({ error: 'Failed to import' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertInvoiceSender(user);
    const body = (await request.json().catch(() => ({}))) as { invoiceIds?: unknown };
    const ids = Array.isArray(body.invoiceIds) ? body.invoiceIds.filter((i): i is string => typeof i === 'string').slice(0, MAX_ROWS) : [];
    if (ids.length === 0) return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
    // Only invoices this import made, and only this person's own.
    const { data, error } = await supabaseServer.from('workspace_invoices').delete().in('id', ids).eq('owner_user_id', user.id).eq('template_key', IMPORT_KEY).select('id');
    if (error) throw error;
    return NextResponse.json({ removed: (data || []).length });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error undoing a QuickBooks import:', error);
    return NextResponse.json({ error: 'Failed to undo' }, { status: 500 });
  }
}
