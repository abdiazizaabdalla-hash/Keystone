import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';
import { generateComplianceExportPdf } from '@/lib/complianceExportPdf';

// GET /api/transactions/[id]/compliance-export -- a timestamped PDF of
// everything on this deal: documents, the full message thread, and the
// checklist, for a brokerage compliance review or an E&O dispute. TC
// (owner or, read-only, a teammate -- same getVisibleTcUserIds rule as
// /api/documents and /api/tasks) and admin only; this is a back-office
// record, not something the invited agent on the deal needs.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { id: transactionId } = await params;

    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not available on the agent portal' }, { status: 403 });
    }

    const { data: transaction, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, purchase_price, status, acceptance_date, closing_date, created_at, agent_id')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    let agent: { name: string; brokerage: string | null } | null = null;
    if (!isAdmin) {
      const visibleIds = await getVisibleTcUserIds(user.id);
      const { data: agentRow } = await supabaseServer
        .from('agents')
        .select('id, name, brokerage')
        .eq('id', transaction.agent_id)
        .in('tc_user_id', visibleIds)
        .single();
      if (!agentRow) {
        return NextResponse.json({ error: 'You do not have permission to export this transaction' }, { status: 403 });
      }
      agent = { name: agentRow.name, brokerage: agentRow.brokerage };
    } else {
      const { data: agentRow } = await supabaseServer
        .from('agents')
        .select('name, brokerage')
        .eq('id', transaction.agent_id)
        .single();
      agent = agentRow ? { name: agentRow.name, brokerage: agentRow.brokerage } : { name: 'Unknown', brokerage: null };
    }

    const [documentsRes, messagesRes, tasksRes] = await Promise.all([
      supabaseServer
        .from('documents')
        .select('file_name, category, document_type, is_signed, requires_signature, created_at')
        .eq('transaction_id', transactionId),
      supabaseServer
        .from('messages')
        .select('sender_role, body, created_at')
        .eq('transaction_id', transactionId),
      supabaseServer
        .from('tasks')
        .select('name, completed, due_date')
        .eq('transaction_id', transactionId)
        .order('sort_order', { ascending: true }),
    ]);

    if (documentsRes.error) throw documentsRes.error;
    if (messagesRes.error) throw messagesRes.error;
    if (tasksRes.error) throw tasksRes.error;

    const pdfBuffer = await generateComplianceExportPdf({
      transaction: {
        file_number: transaction.file_number,
        property_address: transaction.property_address,
        purchase_price: transaction.purchase_price,
        status: transaction.status,
        acceptance_date: transaction.acceptance_date,
        closing_date: transaction.closing_date,
        created_at: transaction.created_at,
      },
      agent: agent!,
      documents: documentsRes.data || [],
      messages: messagesRes.data || [],
      tasks: tasksRes.data || [],
      generatedByName: user.user_metadata?.full_name || user.email || 'Unknown',
      generatedByEmail: user.email || null,
    });

    const safeFileNumber = transaction.file_number.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFileNumber}-compliance-export.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error generating compliance export:', error);
    return NextResponse.json({ error: 'Failed to generate compliance export' }, { status: 500 });
  }
}
