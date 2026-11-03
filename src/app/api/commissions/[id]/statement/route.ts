import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { agentLabels, brokerageOn } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { loadCommissionFor, breakdown } from '@/lib/commissions';
import { splitLabel } from '@/lib/commissionMath';
import { generateCommissionStatementPdf } from '@/lib/commissionStatementPdf';

// The commission statement as a PDF, for the owner or the agent on that commission and nobody else.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const { id } = await params;
    const { row } = await loadCommissionFor(id, user.id);
    const [{ data: tx }, labels] = await Promise.all([
      supabaseServer.from('transactions').select('property_address, file_number').eq('id', row.transaction_id).maybeSingle(),
      agentLabels([row.owner_user_id, row.agent_user_id]),
    ]);
    const b = breakdown(row);
    const pdf = await generateCommissionStatementPdf({
      statementNumber: row.statement_number,
      status: row.status,
      property: (tx?.property_address as string) || '',
      fileNumber: (tx?.file_number as string) || null,
      brokerage: labels.get(row.owner_user_id)?.name ?? 'Brokerage',
      agent: labels.get(row.agent_user_id)?.name ?? 'Agent',
      splitText: splitLabel(row.split_type, Number(row.split_value)),
      gross: b.gross,
      agentShare: b.agentShare,
      brokerageShare: b.brokerageShare,
      deductions: row.deductions ?? [],
      agentNet: b.agentNet,
      brokerageNet: b.brokerageNet,
      paidOn: row.paid_on,
      paidNote: row.paid_note,
    });
    return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${row.statement_number}.pdf"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return oversightError(error, 'create the statement');
  }
}
