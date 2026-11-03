import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { assertWorkspaceAgent, cleanHeader, cleanLines, invoiceTotals, loadOwnInvoice, replaceLines } from '@/lib/workspaceInvoices';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} workspace invoice:`, error);
  return NextResponse.json({ error: `Failed to ${what} invoice` }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    const { id } = await params;
    const { invoice, lines } = await loadOwnInvoice(id, user.id);
    return NextResponse.json({ ...invoice, lines, ...invoiceTotals(lines, invoice.tax_percent) });
  } catch (error) {
    return fail(error, 'load');
  }
}

// PATCH: edit a draft or sent invoice, or move it along with { action: 'mark_paid' | 'void' | 'reopen' }.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    await assertTrialActive(user);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { invoice } = await loadOwnInvoice(id, user.id);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const action = typeof body.action === 'string' ? body.action : '';

    if (action) {
      if (action === 'mark_paid') {
        if (invoice.status === 'void') return NextResponse.json({ error: 'A voided invoice cannot be marked paid.' }, { status: 400 });
        update.status = 'paid';
        update.paid_at = new Date().toISOString();
      } else if (action === 'void') {
        if (invoice.status === 'paid') return NextResponse.json({ error: 'A paid invoice cannot be voided.' }, { status: 400 });
        update.status = 'void';
      } else if (action === 'reopen') {
        update.status = invoice.sent_at ? 'sent' : 'draft';
        update.paid_at = null;
      } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }
    } else {
      if (invoice.status === 'paid' || invoice.status === 'void') {
        return NextResponse.json({ error: 'A paid or voided invoice cannot be edited. Reopen it first.' }, { status: 400 });
      }
      Object.assign(update, cleanHeader(body));
      if (Array.isArray(body.lines)) await replaceLines(id, cleanLines(body.lines));
    }

    const { error } = await supabaseServer.from('workspace_invoices').update(update).eq('id', id);
    if (error) throw error;
    const fresh = await loadOwnInvoice(id, user.id);
    return NextResponse.json({ ...fresh.invoice, lines: fresh.lines, ...invoiceTotals(fresh.lines, fresh.invoice.tax_percent) });
  } catch (error) {
    return fail(error, 'update');
  }
}

// DELETE: only a draft that was never sent. Anything else is voided instead, so the numbering has no gaps.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    assertWorkspaceAgent(user);
    const { id } = await params;
    const { invoice } = await loadOwnInvoice(id, user.id);
    if (invoice.status !== 'draft' || invoice.sent_at) {
      return NextResponse.json({ error: 'Only a draft that was never sent can be deleted. Void it instead.' }, { status: 400 });
    }
    const { error } = await supabaseServer.from('workspace_invoices').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ status: 'deleted' });
  } catch (error) {
    return fail(error, 'delete');
  }
}
