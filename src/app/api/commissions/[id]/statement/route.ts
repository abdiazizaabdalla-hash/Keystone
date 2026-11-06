import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { agentLabels, brokerageOn } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { loadCommissionFor, breakdown } from '@/lib/commissions';
import { grossPercentOfPrice, splitBothSides } from '@/lib/commissionMath';
import { generateCommissionStatementPdf } from '@/lib/commissionStatementPdf';

// The commission statement as a PDF, for the owner or the agent on that commission and nobody else.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const { id } = await params;
    const { row } = await loadCommissionFor(id, user.id);
    const [{ data: tx }, labels] = await Promise.all([
      supabaseServer.from('transactions').select('property_address, file_number, purchase_price').eq('id', row.transaction_id).maybeSingle(),
      agentLabels([row.owner_user_id, row.agent_user_id]),
    ]);
    // The PDF is the final statement: it exists once the brokerage has confirmed the actual commission AND the agent has agreed to it.
    if (row.status === 'estimate' || row.gross_cents === null) throw new AuthError('The PDF is ready once your brokerage confirms the actual commission and you both agree to it.', 409);
    if (row.status !== 'accepted' && row.status !== 'paid') throw new AuthError('The PDF is ready once your brokerage and the agent both agree to the amounts.', 409);
    const b = breakdown(row);
    const num = (n: number | null) => n ?? 0;
    const pdf = await generateCommissionStatementPdf({
      statementNumber: row.statement_number,
      status: row.status,
      property: (tx?.property_address as string) || '',
      fileNumber: (tx?.file_number as string) || null,
      brokerage: labels.get(row.owner_user_id)?.name ?? 'Brokerage',
      agent: labels.get(row.agent_user_id)?.name ?? 'Agent',
      splitText: splitBothSides(row.split_type, Number(row.split_value)),
      salePrice: tx?.purchase_price ? Number(tx.purchase_price) : null,
      grossPercent: grossPercentOfPrice(tx?.purchase_price ? Number(tx.purchase_price) : null, row.gross_cents === null ? null : Number(row.gross_cents)),
      agentPercent: row.split_type === 'percent' ? Number(row.split_value) : null,
      brokeragePercent: row.split_type === 'percent' ? Math.round((100 - Number(row.split_value)) * 1000) / 1000 : null,
      gross: num(b.gross),
      agentShare: num(b.agentShare),
      brokerageShare: num(b.brokerageShare),
      deductions: row.deductions ?? [],
      agentNet: num(b.agentNet),
      brokerageNet: num(b.brokerageNet),
      paidOn: row.paid_on,
      paidNote: row.paid_note,
    });
    return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${row.statement_number}.pdf"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return oversightError(error, 'create the statement');
  }
}
