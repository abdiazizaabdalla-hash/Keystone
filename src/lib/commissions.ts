import { supabaseServer } from './supabase';
import { AuthError } from './auth';
import { computeSplit, fromCents, type Deduction, type SplitType } from './commissionMath';

// Commission agreements and statements between a brokerage owner and one of their agents, deal by deal.
// Only the owner and that agent can see or touch a commission; coordinators and the rest of the team never do.

export type CommissionStatus = 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';

export interface CommissionRow {
  id: string;
  transaction_id: string;
  owner_user_id: string;
  agent_user_id: string;
  statement_number: string;
  gross_cents: number;
  split_type: SplitType;
  split_value: number | string;
  deductions: Deduction[];
  agent_net_cents: number;
  brokerage_net_cents: number;
  status: CommissionStatus;
  change_note: string | null;
  payment_preference: 'relay' | 'outside' | null;
  proposed_at: string;
  accepted_at: string | null;
  paid_on: string | null;
  paid_note: string | null;
  updated_at: string;
}

/** The numbers on a commission, recomputed from what was agreed (never trusted from the client). */
export function breakdown(row: Pick<CommissionRow, 'gross_cents' | 'split_type' | 'split_value' | 'deductions'>) {
  const s = computeSplit({ gross: fromCents(Number(row.gross_cents)), splitType: row.split_type, splitValue: Number(row.split_value), deductions: row.deductions ?? [] });
  return {
    gross: fromCents(s.grossCents),
    agentShare: fromCents(s.agentShareCents),
    brokerageShare: fromCents(s.brokerageShareCents),
    deductionsTotal: fromCents(s.deductionsCents),
    agentNet: fromCents(s.agentNetCents),
    brokerageNet: fromCents(s.brokerageNetCents),
    agentPercentOfGross: s.agentPercentOfGross,
  };
}

export function viewOf(row: CommissionRow) {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    statementNumber: row.statement_number,
    splitType: row.split_type,
    splitValue: Number(row.split_value),
    deductions: row.deductions ?? [],
    status: row.status,
    changeNote: row.change_note,
    // The agent generated this invoice themselves and it is waiting for the brokerage to approve or edit it.
    // (Stored as a change request with no note; a real change request always carries one.)
    submitted: row.status === 'change_requested' && !row.change_note,
    paymentPreference: row.payment_preference,
    proposedAt: row.proposed_at,
    acceptedAt: row.accepted_at,
    paidOn: row.paid_on,
    paidNote: row.paid_note,
    ...breakdown(row),
  };
}

export async function nextStatementNumber(ownerId: string): Promise<string> {
  const { data } = await supabaseServer.from('deal_commissions').select('statement_number').eq('owner_user_id', ownerId);
  let highest = 0;
  for (const r of data ?? []) {
    const m = /^COMM-(\d+)$/.exec(String(r.statement_number));
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `COMM-${String(highest + 1).padStart(4, '0')}`;
}

export async function commissionForTransaction(transactionId: string): Promise<CommissionRow | null> {
  const { data, error } = await supabaseServer.from('deal_commissions').select('*').eq('transaction_id', transactionId).maybeSingle();
  if (error) throw error;
  return (data as CommissionRow | null) ?? null;
}

/** A commission the caller is a party to, or a 404 (a stranger learns nothing). */
export async function loadCommissionFor(id: string, userId: string): Promise<{ row: CommissionRow; side: 'owner' | 'agent' }> {
  const { data, error } = await supabaseServer.from('deal_commissions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  const row = data as CommissionRow | null;
  if (!row) throw new AuthError('Not found', 404);
  if (row.owner_user_id === userId) return { row, side: 'owner' };
  if (row.agent_user_id === userId) return { row, side: 'agent' };
  throw new AuthError('Not found', 404);
}

/** A line in someone's notification bell about a commission. Never throws. */
export async function notifyCommission(params: { recipientId: string; actorId: string; transactionId: string; title: string; link: string }): Promise<void> {
  try {
    await supabaseServer.from('notifications').insert({ recipient_user_id: params.recipientId, actor_user_id: params.actorId, transaction_id: params.transactionId, event_type: 'commission', title: params.title.slice(0, 200), link: params.link });
  } catch (error) {
    console.error('Commission notification failed:', error);
  }
}

export const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
};
