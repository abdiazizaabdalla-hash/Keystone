import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isCollaboratorOnly } from '@/lib/agentPortal';
import { isFeatureOn } from '@/lib/features';
import { loadReceivedInvoices } from '@/lib/receivedInvoices';

// GET: invoices that agents sent to this coordinator (billed to their email, or sent on a deal they are the coordinator on).
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    // Agent-sent invoices only exist where the agent workspace is on; skip the lookups (and the tables) everywhere else.
    if (!isFeatureOn('agent_workspace')) return NextResponse.json([]);
    if (isCollaboratorOnly(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const rows = await loadReceivedInvoices(user);
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        invoice_number: r.invoice_number,
        title: r.title,
        status: r.status,
        issue_date: r.issue_date,
        due_date: r.due_date,
        paid_at: r.paid_at,
        refundedAmount: r.refundedAmount,
        transaction_id: r.transaction_id,
        propertyAddress: r.propertyAddress,
        fromName: r.fromName,
        total: r.total,
        payOnline: r.payOnline,
      }))
    );
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading invoices from agents:', error);
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 });
  }
}
